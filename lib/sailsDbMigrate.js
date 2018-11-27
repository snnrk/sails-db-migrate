'use strict';

var util = require('util');
var fork = require('child_process').fork;
var path = require('path');

/**
 * Build a URL from the Sails datastore config.
 *
 * @param {object} datastore Sails datastore config.
 * @returns {string} URL for connecting to the specified database.
 * @throws Error if adapter is not supported.
 */
function buildURL(datastore) {
  var scheme;
  var url;

  switch (datastore.adapter) {
    case 'sails-mysql':
      scheme = 'mysql';
      break;
    case 'sails-postgresql':
      scheme = 'postgres';
      break;
    case 'sails-mongo':
      scheme = 'mongodb';
      break;
    default:
      throw new Error('migrations not supported for ' + datastore.adapter);
  }

  // return the datastore url if one is configured
  if (datastore.url) {
    return datastore.url;
  }

  url = scheme + '://';
  if (datastore.user) {
    url += datastore.user;
    if (datastore.password) {
      url += ':' + encodeURIComponent(datastore.password);
    }
    url += '@';
  }
  url += datastore.host || 'localhost';
  if (datastore.port) {
    url += ':' + datastore.port;
  }
  if (datastore.database) {
    url += '/' + encodeURIComponent(datastore.database);
  }

  var params = [];
  if (datastore.multipleStatements) {
    params.push('multipleStatements=true');
  }

  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  return url;
}

/**
 * Parse out the database URL from the sails config.
 *
 * @param sailsConfig Sails config object.
 * @returns {object} .url and .cleanURL for the database datastore.
 * @throws Error if adapter is not supported.
 */
function parseSailsConfig(sailsConfig) {
  var res = {};
  var datastore;

  if (!sailsConfig.migrations) {
    throw new Error('Migrations not configured. Please setup ./config/migrations.js');
  }

  var datastoreName = sailsConfig.migrations.datastore;
  if (!datastoreName) {
    throw new Error('datastore missing from ./config/migrations.js');
  }

  datastore = sailsConfig.datastores[datastoreName];

  if (!datastore) {
    throw new Error('could not find datastore ' + datastoreName + ' in ./config/datastores.js');
  }

  // build the db url, which contains the password
  res.url = buildURL(datastore);
  // check for ssl option in datastore config
  if (datastore.ssl) {
    res.adapter = datastore.adapter;
    res.ssl = true;
  }
  // now build a clean one for logging, without the password
  if (datastore.password != null) {
    datastore.password = '****';
  }
  res.cleanURL = buildURL(datastore);

  return res;
}

/**
 * Run the database migrations on the given sails object.
 *
 * @param args Command line arguments to pass to db:migrate
 * @param [sails] Sails object to migrate. Defaults to the global sails object.
 * @param done Completion callback.
 * @return The URL for the database to be migrated.
 */
module.exports = function (args, sails, done) {
  var dbMigrate = path.join(__dirname, 'db-migrate-wrapper.js');
  var parsed, child;

  if (!done && typeof (sails) === 'function') {
    done = sails;
    sails = global.sails;
  }

  parsed = parseSailsConfig(sails.config);

  // export DATABASE_URL for db-migrate
  process.env.DATABASE_URL = parsed.url;
  // export PGSSLMODE for db-migrate if ssl=true
  if (parsed.ssl) {
    // set the appropriate environment variable for postgres databases
    if (parsed.adapter === 'sails-postgresql') {
      process.env.PGSSLMODE = 'require';
    }
  }
  // run db-migrate
  // the empty execArgv option explicitly disables debugging options from being passed to the child,
  // which was causing problems when trying to interactively debug an application that calls sails-db-migrate.
  child = fork(dbMigrate, args, { execArgv: [] });
  child.on('exit', function (code) {
    if (code !== 0) {
      return done(new Error('Migrations failed'));
    }
    done();
  });

  return parsed.cleanURL;
};
