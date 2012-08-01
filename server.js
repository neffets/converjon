#!/usr/bin/env node

var config = require('config');

process.env.NODE_CONFIG_DIR = __dirname + '/config';

var applyDefaults = require('./defaults');
var args = require('argsparser').parse();
args = applyDefaults(args);

if ("help" in args && args.help)
{
    console.log("\nUsage:");
    console.log("\n-p <port> Sets the server port to <port>, defaults to 8000");
    console.log("\n-h/--help Displays this message.");
    console.log("\n");
    process.exit();
}

require('./lib/preparations');

var connect = require('connect');

var server = connect();
server.use(require('connect-bouncer')(require('config').bouncer));
if (config.logging) server.use(connect.logger());
server.use(require('./lib/demoPage')());
server.use(require('./lib/requestParser')());
server.use(require('./lib/urlChecker')());
server.use(require('./lib/imageFetcher')());

server.listen(args.port);

console.log('Server running on port ' + args.port);

