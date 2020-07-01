#!/usr/bin/env node
var path = require('path')

var JSONSaver = require('../lib/jsonsaver')
var PGSaver = require('../lib/pgsaver')

var filename = process.argv[2]
var pg_url = process.argv[3]

if (!filename || !pg_url) {
   console.log('USAGE: migrate-jsonsaver {path to file} {postgres url}')
   process.exit(0)
}

json = new JSONSaver(filename)

pg = new PGSaver(pg_url, path.basename(filename, '.json').replace(/^purr-/, ''))

pg.instantwrite = true

var load_count = 2

json.on('loaded', () => {
   console.log(`Current data loaded from ${filename}...`)
   console.log(json.object)
   load_count--
   if (!load_count) {
      on_load()
   }
})

pg.on('loaded', () => {
   console.log(`Current data loaded from ${pg_url}...`)
   console.log(pg.object)
   load_count--
   if (!load_count) {
      on_load()
   }
})

function on_load() {
   console.log('Migrating data onto postgres object...')
   Object.assign(pg.object, json.object)
   console.log('Flushing to postgres...')
   pg.activity()

   pg.on('flushed', () => {
      console.log('Done.')
      process.exit()
   })
}
