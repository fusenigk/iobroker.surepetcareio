/**
 *
 * surepetcareio adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "surepetcareio",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js surepetcareio Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@surepetcareio.com>"
 *          ]
 *          "desc":         "surepetcareio adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "materialize":  true,                       // support of admin3
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42,
 *          "mySelect": "auto"
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.surepetcareio.0
const adapter = new utils.Adapter('surepetcareio');

const https = require('https');
const util = require('util')
const prettyMs = require('pretty-ms');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('config username: '    + adapter.config.username);
    adapter.log.info('config password: '    + adapter.config.password);

    // in this surepetcareio all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');

    adapter.setObject('connected', {
        type: 'state',
        common: {
            name: 'connected',
            type: 'boolean',
            role: 'indicator'
        },
        native: {}
    });
    adapter.setState('connected', false, true);

    do_login();
}

var privates = {};

function timeout_callback()
{
    get_control(function() {
        get_pets(function() {
            setTimeout(timeout_callback, 10*1000);
        }) });
}

function build_options(path, method, token) {
    var options = {
        hostname: 'app.api.surehub.io',
        port: 443,
        path: path,
        method: method,
        headers: {
            "Host" : "app.api.surehub.io",
            "Accept" : "application/json, text/plain, */*",
            "Referer" : "https://surepetcare.io/",
            "Content-Type" : "application/json;charset=utf-8",
            "Origin" :  "https://surepetcare.io",
        }
    };

    if (token != undefined) {
        options.headers["Authorization"] = 'Bearer ' + token;
    }

    return options;
}

function do_login() {
    console.info('trying to login...');
    login(adapter.config.username, adapter.config.password, get_household);
}

function login(username, password, callback) {
  var postData = JSON.stringify(
  { 'email_address':username,'password':password, 'device_id':'1050547954'}
  );

  var options = build_options('/api/auth/login', 'POST');

  var req = https.request(options, (res) => {
    adapter.log.debug('login statusCode: ' + res.statusMessage + '(' +  res.statusCode + ')');
    adapter.log.debug('login headers:' + util.inspect(res.headers, false, null, true /* enable colors */));

    res.on('data', (d) => {
        var obj = JSON.parse(d);
        adapter.log.debug(util.inspect(obj, false, null, true /* enable colors */));

        if (obj == undefined || obj.data == undefined || !('token' in obj.data)) {
            adapter.log.info('no token in adapter, retrying login in 5 secs...');
            setTimeout(do_login, 5*1000);
        } else {
            var token = obj.data['token'];
            privates['token'] = token;
            callback();
        }
    });
  });

  req.on('error', (e) => {
    console.error(e);
  });

  req.write(postData);
  req.end();
}

function get_household() {
    var options = build_options('/api/household?with[]=household', 'GET', privates['token']);

    var req = https.request(options, (res) => {
        adapter.log.debug('get_household statusCode: ' + res.statusMessage + '(' +  res.statusCode + ')');
        adapter.log.debug('get_household headers:' + util.inspect(res.headers, false, null, true /* enable colors */));

        res.on('data', (d) => {
            var obj = JSON.parse(d);
            adapter.log.debug(util.inspect(obj, false, null, true /* enable colors */));

            privates['household'] = obj.data[0]['id'];
            adapter.setState('connected',true, true, function(err) {
                adapter.log.info('connected...');
                setTimeout(timeout_callback, 100);
            });
        });
    });

    req.on('error', (e) => {
        console.error(e);
    });

    req.write('');
    req.end();
}

function get_pets(callback) {
    if (!('token' in privates)) {
        console.info('no token in adapter');
    }
    var options = build_options('/api/household/' + privates['household'] + '/pet?with[]=position', 'GET', privates['token']);

    var req = https.request(options, (res) => {
        adapter.log.debug('get_pets statusCode: ' + res.statusMessage + '(' +  res.statusCode + ')');
        adapter.log.debug('get_pets headers:' + util.inspect(res.headers, false, null, true /* enable colors */));

        res.on('data', (d) => {
            var obj = JSON.parse(d);
            adapter.log.debug(util.inspect(obj, false, null, true /* enable colors */));

            var len = obj.data.length;
            for (var i = 0; i < len; i++) {
                var name = obj.data[i].name;
                var where = obj.data[i].position.where;
                var since = obj.data[i].position.since
                adapter.log.info(name + ' is ' + where + ' since ' + prettyMs(Date.now() - new Date(since)));

                adapter.setObject('pets.' + name, {
                    type: 'state',
                    common: {
                        name: 'pets.' + name,
                        type: 'boolean',
                        role: 'indicator'
                    },
                    native: {}
                });

                adapter.setState('pets.' + name, (where == 1) ? true : false, true);
            }
            callback();
        });
    });

    req.on('error', (e) => {
        console.error(e);
    });

    req.write('');
    req.end();
}

function get_control(callback) {
    if (!('token' in privates)) {
        console.info('no token in adapter');
    }
    var options = build_options('/api/me/start', 'GET', privates['token']);

    var req = https.request(options, (res) => {
        adapter.log.debug('get_pets statusCode: ' + res.statusMessage + '(' +  res.statusCode + ')');
        adapter.log.debug('get_pets headers:' + util.inspect(res.headers, false, null, true /* enable colors */));

        res.on('data', (d) => {
            var obj = JSON.parse(d);
            adapter.log.debug(util.inspect(obj, false, null, true /* enable colors */));
            privates.devices = obj.data.devices;
            privates.households = obj.data.households;
            privates.pets = obj.data.pets;
            callback();
        });
    });

    req.on('error', (e) => {
        console.error(e);
    });

    req.write('');
    req.end();
}
