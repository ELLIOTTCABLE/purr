var events = require('events')

var pg = require('pg')

var _client_cache = {}

class PGSaver extends events.EventEmitter {
   constructor(url, table) {
      super()

      this.object = {}

      this.wait = 8 * 1000 // wait after 8 seconds of inactivity before writing to pg

      this.url = url
      this.table = table

      if (_client_cache[url]) {
         this.client = _client_cache[url]
      } else {
         this.client = new pg.Client({
            connectionString: url,
            ssl: {
               rejectUnauthorized: false,
            },
         })

         this.client.connect()

         _client_cache[url] = this.client
      }

      this.timeout = null
      this.instantwrite = false
      this.loaded = false

      var data = {}

      console.log(`Loading ${this.table} from ${this.url}...`)

      this.client.query(
         `
         CREATE TABLE IF NOT EXISTS ${this.table} (
            key text PRIMARY KEY NOT NULL,
            value JSONB
         );
      `,
         (err, res) => {
            if (err) {
               this.emit('error', err)
               return
            }

            this.client.query(
               `
            SELECT
               key,
               value
            FROM ${this.table};
             `,
               (err, res) => {
                  if (err) {
                     this.emit('error', err)
                     return
                  }

                  res.rows.forEach((row) => {
                     data[row.key] = row.value
                  })

                  if (Object.keys(this.object)) {
                     for (var i in this.object) {
                        if (this.object.hasOwnProperty(i)) {
                           data[i] = this.object[i]
                        }
                     }
                  }
                  this.object = data
                  this.loaded = true
                  console.log(`Loaded ${this.table} from ${this.url}.`)
                  this.emit('loaded')
               },
            )
         },
      )

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
      if (this.flushing) {
         console.log(`Still flushing ${this.table} at ${this.url}!`)
         console.log("Waiting until it's done...")

         this.once('flushed', () => {
            this.flush()
         })

         return
      }

      console.log(`Flushing ${this.table} at ${this.url}...`)

      this.emit('flush')
      this.flushing = true

      this.client.query('BEGIN', (err) => {
         if (err) {
            this.emit('error', err)
            return
         }

         this.client.query(
            `
         CREATE TABLE IF NOT EXISTS ${this.table}_tmp (
            key text PRIMARY KEY NOT NULL,
            value JSONB
         );

         TRUNCATE TABLE ${this.table}_tmp;
         `,
            (err) => {
               if (err) {
                  this.emit('error', err)
                  return
               }

               // I probably shoulda used a query builder, womp womp
               var data = Object.entries(this.object)

               var insert = data
                  .map((_, i) => {
                     var j = 2 * (i + 1)
                     return `($${j - 1}, $${j})`
                  })
                  .join(', ')

               data = data.reduce((acc, row) => acc.concat(row), [])

               this.client.query(
                  `

               INSERT INTO ${this.table}_tmp(key, value) VALUES ${insert};
               `,
                  data,
                  (err) => {
                     if (err) {
                        this.emit('error', err)
                        return
                     }

                     this.client.query(
                        `
                     DROP TABLE IF EXISTS ${this.table}_old;
                     ALTER TABLE ${this.table} RENAME TO ${this.table}_old;
                     ALTER TABLE ${this.table}_tmp RENAME TO ${this.table};
                     DROP TABLE ${this.table}_old;
                     `,
                        (err) => {
                           if (err) {
                              this.emit('error', err)
                              return
                           }

                           this.client.query('COMMIT;', (err) => {
                              if (err) {
                                 this.emit('error', err)
                                 return
                              }

                              this.flushing = false

                              console.log(`Flushed ${this.table} at ${this.url}.`)

                              this.emit('flushed')
                           })
                        },
                     )
                  },
               )
            },
         )
      })
   }

   clean() {
      this.object = {}
      this.activity()
   }
}

module.exports = PGSaver
