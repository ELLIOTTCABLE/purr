var Utils = require('util')
var File = require('fs')
var PGSaver = require('../pgsaver')
var Sol = require('../sol')

var FactoidServer = (module.exports = function (pg_url) {
   this.pg_url = pg_url
   this.changed = false
   this.loaded = false
   this.db = new PGSaver(pg_url, 'factoids')
})

FactoidServer.prototype.serialize_user = function (user) {
   if (!user) {
      return null
   }

   return {
      id: user.id, // User's ID in discord
      username: user.username,
      discriminator: user.discriminator,
      nickname: user.nickname, // User's nickname at the time
      tag: `${user.author}`, // The magic string to at someone in Discord
   }
}

// The factoid server may have modified_by fields set to old nicknames rather
// than serialized user objects - this normalizes them to have the same fields
FactoidServer.prototype.normalize_user_data = function (user_data) {
   if (typeof user === 'string') {
      if (user === '<unknown>') {
         return null
      }

      return {
         id: null,
         username: null,
         discriminator: null,
         nickname: user,
         tag: null,
      }
   }

   return user
}

FactoidServer.prototype.learn = function (key, value, modified_by) {
   var db = this.db.object.factoids

   var popularity = 0
   key = key.toLowerCase()

   if (typeof db[key] !== 'undefined') {
      if (typeof db[key].alias !== 'undefined') {
         return this.learn(db[key].alias, value)
      }
      popularity = db[key].popularity || 0
   }

   db[key] = {
      value: value,
      popularity: popularity,
      modified_by: this.serialize_user(modified_by),
      timestamp: new Sol().toString(),
   }
   this.db.activity()
}

FactoidServer.prototype.alias = function (alias, key) {
   key = key.toLowerCase()
   alias = alias.toLowerCase()

   var db = this.db.object.factoids

   if (typeof db[key] === 'undefined')
      throw new Error('Factoid `' + key + "` doesn't exist.")

   if (typeof db[key].alias !== 'undefined') {
      return this.alias(alias, db[key].alias)
   }

   if (alias === key) throw new Error('Cannot alias yourself.')

   db[alias] = {alias: key}
   this.db.activity()
   return key
}

FactoidServer.prototype.find = function (key, incpop) {
   key = key.toLowerCase()
   var db = this.db.object.factoids

   if (typeof db[key] === 'undefined') {
      throw new Error('Factoid `' + key + '` was not found.')
   }

   if (typeof db[key].alias !== 'undefined') {
      return this.find(db[key].alias)
   }

   var thing = db[key]
   if (incpop) {
      thing.popularity = thing.popularity || 0
      thing.popularity++
   }

   return thing.value
}

FactoidServer.prototype.search = function (pattern, num) {
   if (typeof num !== 'number') num = 5
   var found = [],
      cat,
      db = this.db.object.factoids
   pattern = pattern.toLowerCase()

   for (var i in db) {
      if (db.hasOwnProperty(i)) {
         if (typeof db[i].value === 'undefined') continue

         cat = (i + ' ' + db[i].value).toLowerCase()
         if (~cat.indexOf(pattern)) {
            i.modified_by = this.normalize_user_data(i.modified_by)
            found.push(i)
         }
      }
   }

   found.sort(function (a, b) {
      return db[b].popularity - db[a].popularity
   })
   return found.slice(0, num)
}

FactoidServer.prototype.forget = function (key) {
   key = key.toLowerCase()
   var db = this.db.object.factoids

   if (typeof db[key] === 'undefined') {
      throw new Error('`' + key + '` was not a factoid.')
   }
   delete db[key]
   this.db.activity()
   return true
}

FactoidServer.prototype.clean = function () {
   var db = this.db.object.factoids,
      j,
      i
   for (i in db) {
      if (db.hasOwnProperty(i)) {
         if (typeof db[i].alias !== 'undefined') {
            for (j in db[i]) {
               if (db[i].hasOwnProperty(j)) {
                  if (j !== 'alias') delete db[i][j]
               }
            }
            continue
         }
         if (typeof db[i].value !== 'undefined') {
            for (j in db[i]) {
               if (db[i].hasOwnProperty(j)) {
                  if (j !== 'value' && j !== 'popularity') delete db[i][j]
                  if (j !== 'value') delete db[i][j]
               }
            }
            continue
         }
         delete db[i]
      }
   }
   this.db.activity()
}
