var events = require('events')

var redis = require('redis')

var _client_cache = {}

class RedisSaver extends events.EventEmitter {
   constructor(url, prefix) {
      super()

      this.object = {}

      this.wait = 8 * 1000 // wait after 8 seconds of inactivity before writing to redis

      this.prefix = prefix
      this.url = url

      if (_client_cache[url]) {
         this.client = _client_cache[url]
      } else {
         this.client = redis.createClient(url)
         _client_cache[url] = this.client
      }

      this.timeout = null
      this.instantwrite = false
      this.loaded = false

      console.log(`Loading ${this.prefix} from ${this.url}...`)

      this.client.keys(`${this.prefix}:*`, (err, keys) => {
         if (err) {
            this.emit('error', err)
            return
         }

         var i = 0

         var data = {}

         var finish = () => {
            if (Object.keys(this.object)) {
               for (var i in this.object) {
                  if (this.object.hasOwnProperty(i)) {
                     data[i] = this.object[i]
                  }
               }
            }
            this.object = data
            this.loaded = true
            console.log(`Loaded ${this.prefix} from ${this.url}.`)
            this.emit('loaded')
         }

         var load_keys = (i) => {
            if (i === keys.length) {
               finish()
               return
            }

            this.client.get(keys[i], (err, serialized) => {
               if (err) {
                  throw err
               }

               data[keys[i].replace(new RegExp(`^${prefix}:`), '')] = JSON.parse(
                  serialized,
               )
               load_keys(i + 1)
            })
         }

         load_keys(0)
      })

      var flush_if_changed = () => {
         if (this.changed) {
            this.flush()
         }
      }

      //process.on('SIGINT', flush_if_changed)
      //process.on('SIGTERM', flush_if_changed)
   }

   activity() {
      this.changed = true

      if (this.timeout !== null) {
         clearTimeout(this.timeout)
      }

      if (!this.instantwrite) {
         this.timeout = setTimeout(() => {
            if (this.changed) {
               this.flush()
            }
         }, this.wait)
      } else {
         if (this.changed) {
            this.flush()
         }
      }
   }

   flush() {
      console.log(`Flushing ${this.prefix} to ${this.url}...`)
      this.emit('flush')
      var keys = Object.keys(this.object)
      var write_keys = (i) => {
         if (i === keys.length) {
            this.changed = false
            console.log(`Flushed ${this.prefix} to ${this.url}.`)
            this.emit('flushed')
            return
         }
         var key = `${this.prefix}:${keys[i]}`
         try {
            var write = JSON.stringify(this.object[keys[i]], null, '\t')
         } catch (err) {
            this.emit('error', err)
         }

         if (write) {
            this.client.set(key, write, (err) => {
               if (err) {
                  this.emit('error', err)
                  return
               }
               write_keys(i + 1)
            })
         }
      }

      write_keys(0)
   }

   clean() {
      this.object = {}
      this.activity()
   }
}

module.exports = RedisSaver
