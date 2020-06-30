#!/usr/bin/env node

var JSONSaver = require('../lib/jsonsaver')
var RedisSaver = require('../lib/redissaver')

var filename = process.argv[2]
var redis_url = process.argv[3]

if (!filename || !redis_url) {
   console.log('USAGE: migrate-jsonsaver {path to file} {redis url}')
   process.exit(0)
}

json = new JSONSaver(filename)

redis = new RedisSaver(redis_url, 'factoids')

redis.instantwrite = true

var load_count = 2

json.on('loaded', () => {
   console.log(`Current data loaded from ${filename}...`)
   console.log(json.object)
   load_count--
   if (!load_count) {
      on_load()
   }
})

redis.on('loaded', () => {
   console.log(`Current data loaded from ${redis_url}...`)
   console.log(redis.object)
   load_count--
   if (!load_count) {
      on_load()
   }
})

function on_load() {
   console.log('Migrating data onto redis object...')
   Object.assign(redis.object, json.object)
   console.log('Flushing redis...')
   redis.activity()

   redis.on('flushed', () => {
      console.log('Done.')
      process.exit()
   })
}
