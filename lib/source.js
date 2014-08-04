/* jshint globalstrict: true */
/* global require */
/* global module */
"use strict";

var fs = require("fs");
var http = require("http");
var https = require("http");
var rsvp = require("rsvp");
var Promise = rsvp.Promise;
var path_sep = require("path").sep;
var request = require("request");
var parse_url = require("url").parse;

var pathutils = require("./pathutils");
var fsutils = require("./fsutils");
var lock = require("./lock");
var analyze = require("./analyze");

var active_list = {};

function write_source_files(url, config, source_lock, meta_lock) {
    var source_file_path = source_lock.key;
    var meta_file_path = meta_lock.key;
    return new Promise(function(resolve, reject) {
        var response_stream;
        /*
         * using `request` this way allows to stream the response 
         * while still being able to react to status codes/headers, etc …
         */
        response_stream = request.get(url);
        response_stream.on("error", function(err) {
            reject(err);
        });
        response_stream.on("response", function(response) {

            if (response.statusCode >= 400) {
                reject(new Error("HTTP " + response.statusCode));
                return;
            }
            var writing_promise = new Promise(function(resolve, reject) {
                var write_stream = fs.createWriteStream(source_file_path);

                response_stream.on("end", function() {
                    resolve();
                });

                write_stream.on("error", function(err) {
                    reject(err);
                });

                response_stream.pipe(write_stream);
            });

            writing_promise.then(function() {
                return analyze(source_lock, config);
            }).then(function(analysis_report) {
                //promise for writing the metadata
                return new Promise(function(resolve, reject) {
                    var meta_data = {
                        headers: response.headers,
                        analysis: analysis_report
                    };
                    fs.writeFile(meta_file_path, JSON.stringify(meta_data), function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });

                });
            }).then(
                function(){
                    resolve();
                },
                function(err) {
                    reject(err);
                }
            );
        });
    });
}



var get_source = function(url, config) {
    //var dir_path;
    var promise;

    function removeFromActiveList () {
        if (url in active_list) {
            delete active_list[url];
        }
    }

    promise = new Promise(function(resolve, reject){

        var dir_path = pathutils.join([
            config.cache.base_path,
            pathutils.getHashPath(url),
        ]);

        resolve(dir_path);
    }).then(
        function(dir_path) {
            return fsutils.mkdirp(dir_path);
        }
    ).then(
        function(dir_path) {
            var source_file_path = pathutils.join([
                dir_path,
                "source"
            ]);
            var meta_file_path = pathutils.join([
                dir_path,
                "meta"
            ]);

            var files_promise = rsvp.hash({
                source: lock(source_file_path),
                meta: lock(meta_file_path)
            }).then(function(locks) {
                /*
                 * make a funciton to bundle both lock releases
                 *
                 * source image and metadata file sould be locked and unlocked
                 * at the same time because they descripe the state of the same resource
                 */
                function free() {
                    locks.source();
                    locks.meta();
                }

                //files are now locked
                return new Promise(function(resolve, reject) {
                    var locked_promise = write_source_files(
                        url,
                        config,
                        locks.source,
                        locks.meta
                    );
                    //always call `free()` regardless of the outcome
                    locked_promise.then(function() {
                        free();
                        resolve(dir_path);
                    }, function(err) {
                        free();
                        reject(err);
                    });
                });
            });

            return files_promise;
        }
    );

    // regardless of how the promise finishes,
    // remove this url from the active downloads list
    promise.then(removeFromActiveList, removeFromActiveList);

    return promise;
};

module.exports = function(url, config) {
    /*
     * if there's already an unresolved promise for this url, return that one
     * instead of starting a second download of source files
     */
    if (!(url in active_list)) {
        active_list[url] = get_source(url, config);
    }

    return active_list[url];
};
