var Events = require('events')
var File = require('fs')
var Path = require('path')

class JSONSaver extends Events.EventEmitter {
   constructor(file) {
      super()
      this.object = {}

      this.wait = 8 * 1000 // wait after 8 seconds of inactivity before writing to disk
      this.file = file
      this.timeout = null
      this.instantwrite = false
      this.loaded = false

      File.readFile(
         this.file,
         function (err, data) {
            try {
               if (err) {
                  this.emit('error', err)
                  return
               }
               console.log('Loaded file: ' + Path.basename(this.file))
               var data = JSON.parse(data)
               if (Object.keys(this.object)) {
                  for (var i in this.object) {
                     if (this.object.hasOwnProperty(i)) {
                        data[i] = this.object[i]
                     }
                  }
               }
               this.object = data
               this.loaded = true
               this.emit('loaded')
            } catch (e) {
               console.log('JSON Parse Error: ' + e)
            }
         }.bind(this),
      )

      process.on(
         'exit',
         function () {
            if (this.changed) {
               this.flush()
            }
         }.bind(this),
      )
   }

   activity() {
      this.changed = true

      if (this.timeout !== null) {
         clearTimeout(this.timeout)
      }

      if (!this.instantwrite) {
         this.timeout = setTimeout(
            function () {
               if (this.changed) {
                  this.flush()
               }
            }.bind(this),
            this.wait,
         )
      } else {
         if (this.changed) {
            this.flush()
         }
      }
   }

   flush() {
      var self = this
      try {
         var write = JSON.stringify(this.object, null, '\t')
         File.writeFile(this.file, write, function (err) {
            if (err) {
               this.emit(err)
               return
            }
            this.emit('flushed')
            console.log('Wrote file: ' + Path.basename(self.file))
         })
         this.changed = false
         return true
      } catch (e) {
         console.log('Cannot stringify data: ' + e.name + ': ' + e.message)
         return false
      }
   }

   clean() {
      this.object = {}
      this.activity()
   }
}

module.exports = JSONSaver
