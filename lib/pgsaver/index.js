var events = require('events')

var knex = require('knex')

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
         this.client = knex({
            client: 'pg',
            // TODO: Production Heroku postgres requires SSL on and rejectUnauthorized: false
            connection: url,
         })

         _client_cache[url] = this.client
      }

      this.timeout = null
      this.instantwrite = false
      this.loaded = false

      var data = {}

      console.log(`Loading ${this.table} from ${this.url}...`)

      this.client.schema
         .raw(
            `
         CREATE TABLE IF NOT EXISTS ${this.table} (
            key text PRIMARY KEY NOT NULL,
            value JSONB
         );
      `,
         )
         .then(() =>
            this.client(this.table)
               .select({
                  key: 'key',
                  value: 'value',
               })
               .stream((stream) => {
                  stream.on('data', (row) => {
                     data[row.key] = row.value
                  })
               }),
         )
         .then(() => {
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
         })
         .catch((err) => {
            this.emit('error', err)
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

      this.client
         .transaction((txn) =>
            txn.schema
               .raw(
                  `
                  CREATE TABLE IF NOT EXISTS ${this.table}_tmp (
                     key text PRIMARY KEY NOT NULL,
                     value JSONB
                  );
                  `,
               )
               .then(() => txn.truncate(`${this.table}_tmp`))
               .then(() =>
                  txn(`${this.table}_tmp`).insert(
                     Object.entries(this.object).map(([key, value]) => {
                        key, value
                     }),
                  ),
               )
               .then(() =>
                  txn.schema.raw(`
                     DROP TABLE IF EXISTS ${this.table}_old;
                     ALTER TABLE ${this.table} RENAME TO ${this.table}_old;
                     ALTER TABLE ${this.table}_tmp RENAME TO ${this.table};
                     DROP TABLE ${this.table}_old;
                  `),
               ),
         )
         .catch((err) => {
            if (err) {
               this.emit('error', err)
            }
         })
   }

   clean() {
      this.object = {}
      this.activity()
   }
}

module.exports = PGSaver
