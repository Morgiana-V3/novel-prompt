// Fail test processes without Electron's modal uncaught-exception dialog.
// Keep production error handling separate; this module is loaded only by tests.
const { writeSync } = require('node:fs')
const { app } = require('electron')

function fail(error) {
  try {
    writeSync(2, `TEST_MAIN_PROCESS_ERROR: ${error?.stack ?? String(error)}\n`)
  } finally {
    app.exit(1)
  }
}

process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)
