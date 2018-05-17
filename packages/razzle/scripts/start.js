#! /usr/bin/env node
'use strict';

process.env.NODE_ENV = 'development';
const fs = require('fs-extra');
const webpack = require('webpack');
const paths = require('../config/paths');
const createConfig = require('../config/createConfig');
const webpackDevServer = require('webpack-dev-server');
const printErrors = require('@carable/razzle-dev-utils/printErrors');
const clearConsole = require('react-dev-utils/clearConsole');
const logger = require('@carable/razzle-dev-utils/logger');
const setPorts = require('@carable/razzle-dev-utils/setPorts');
const cluster = require('cluster');

process.noDeprecation = true; // turns off that loadQuery clutter.

if (process.argv.includes('--inspect-brk')) {
  process.env.INSPECT_BRK_ENABLED = true;
} else if (process.argv.includes('--inspect')) {
  process.env.INSPECT_ENABLED = true;
}

function main() {
  // Optimistically, we make the console look exactly like the output of our
  // FriendlyErrorsPlugin during compilation, so the user has immediate feedback.
  // clearConsole();
  logger.start('Compiling...');
  let razzle = {};

  // Check for razzle.config.js file
  if (fs.existsSync(paths.appRazzleConfig)) {
    try {
      razzle = require(paths.appRazzleConfig);
    } catch (e) {
      clearConsole();
      logger.error('Invalid razzle.config.js file.', e);
      process.exit(1);
    }
  }

  // Delete assets.json to always have a manifest up to date
  fs.removeSync(paths.appManifest);

  // Create dev configs using our config factory, passing in razzle file as
  // options.
  let clientConfig = createConfig('web', 'dev', razzle);
  let serverConfig = createConfig('node', 'dev', razzle);

  // Check if razzle.config has a modify function. If it does, call it on the
  // configs we just created.
  if (razzle.modify) {
    clientConfig = razzle.modify(
      clientConfig,
      { target: 'web', dev: true },
      webpack
    );
    serverConfig = razzle.modify(
      serverConfig,
      { target: 'node', dev: true },
      webpack
    );
  }

  let multiCompiler;
  try {
    multiCompiler = webpack([clientConfig, serverConfig]);
  } catch (e) {
    printErrors('Failed to compile.', [e]);
    process.exit(1);
  }

  // This will listen to any console events send by the compiled server and redirect to them to ours
  const workers = new Map();
  cluster.on('online', () => {
    for (const worker in cluster.workers) {
      // check if we didn't already hook this worker yet
      if (!workers.has(worker)) {
        workers.set(worker, null);
        cluster.workers[worker].on('message', message => {
          if (message.cmd === 'console') {
            console[message.type](...message.args);
          }
        });
      }
    }
  });

  const serverCompiler = multiCompiler.compilers[1];

  // Start our server webpack instance in watch mode.
  serverCompiler.watch(
    {
      quiet: true,
      stats: 'none',
    },
    /* eslint-disable no-unused-vars */
    stats => {}
  );

  // Compile our assets with webpack
  const clientCompiler = multiCompiler.compilers[0];

  // Create a new instance of Webpack-dev-server for our client assets.
  // This will actually run on a different port than the users app.
  const clientDevServer = new webpackDevServer(clientCompiler, clientConfig.devServer);

  // Start Webpack-dev-server
  clientDevServer.listen(
    (process.env.PORT && parseInt(process.env.PORT) + 1) || razzle.port || 3001,
    err => {
      if (err) {
        logger.error(err);
      }
    }
  );

  // We only start requiring CompilationStatus here, because it will start redirecting console output once it's required.
  // We only want this to happen after webpack & the devserver have successfully booted up.
  const CompilationStatus = require('@carable/razzle-dev-utils/CompilationStatus');
  CompilationStatus.startRender(multiCompiler.compilers);
}

// Webpack compile in a try-catch
function compile(config) {
  let compiler;
  try {
    compiler = webpack(config);
  } catch (e) {
    printErrors('Failed to compile.', [e]);
    process.exit(1);
  }
  return compiler;
}

setPorts()
  .then(main)
  .catch(console.error);
