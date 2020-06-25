var fs = require('fs')
var url = require('url')
var util = require('util')
var http = require('http')
var path = require('path')
var querystring = require('querystring')

var request = require('request')
var cheerio = require('cheerio')

var Bot = require('./lib/irc')
var Client = require('./lib/irc/client')

var Sol = require('./lib/sol')
var Sandbox = require('./lib/sandbox')
var FactoidServer = require('./lib/factoidserv')
var JSONSaver = require('./lib/jsonsaver')
var FeelingLucky = require('./lib/feelinglucky')

var paws = require('./lib/µpaws.js/µpaws.js')

var Shared = require('./shared')

String.prototype.repeat = function (i) {
   var d = '',
      t = this
   while (i) {
      if (i & 1) {
         d += t
      }
      t += t
      i >>= 1
   }
   return d
}

String.prototype.trim = function () {
   return String(this).replace(/^\s+|\s+$/g, '')
}

function merge(defaults, options) {
   if (typeof options === 'undefined') return defaults
   var o = {}
   for (var i in defaults) {
      if (defaults.hasOwnProperty(i)) {
         o[i] = typeof options[i] === 'undefined' ? defaults[i] : options[i]
      }
   }
   return o
}

function eval_with_context(context, code) {
   with (context) {
      return eval(code)
   }
}

class Purr extends Bot {
   constructor(profile) {
      super(profile)

      this.sandbox = new Sandbox(path.join(__dirname, 'purr-utils.js'))
      this.factoids = new FactoidServer(
         path.join(__dirname, 'data', 'purr-factoids.json'),
      )
      this.loves = new JSONSaver(path.join(__dirname, 'data', 'purr-loves.json'))
      this.what = new JSONSaver(path.join(__dirname, 'data', 'purr-what.json'))

      this.code_sessions = {}
      this.code_session_timeout = 120
      this.last_message = {}

      this.last_invocation = {}

      this.set_log_level(this.LOG_ALL)
      this.set_trigger('-')
   }

   init() {
      Bot.prototype.init.call(this)

      var bot = this

      this.on('connect', function (client) {
         client.on('message', function (channel, user, text) {
            bot.last_message[user.name + channel.name] = text
         })

         client.on('join', function (channel) {
            channel.on('send', function (data) {
               util.log(util.inspect(data))
               var m = data.match(/^PRIVMSG (#[^ :]+) :(.*)/)
               if (m) {
                  bot.last_message['purr' + m[1]] = m[2]
               }
            })
         })
      })

      this.register_listener(
         /^\|\| (.*)/,
         function (ctx, _, code) {
            var sess = this.code_session(ctx.sender.name)
            sess.code += code + '\n'
         },
         {allow_intentions: false},
      )
      this.register_listener(
         /^((?:sm?|v8?|js?|>>?)>)([^>].*)+/,
         function (ctx, _, mode, code) {
            var sess = this.code_session(ctx.sender.name)
            this.eval_priv(ctx, mode, sess.code + code + '\n')
            sess.code = ''
         },
         {allow_intentions: false},
      )
      this.register_command(
         'uncode',
         function (ctx) {
            this.clear_code_session(ctx.sender.name)
            ctx.channel.send_reply(
               ctx.sender,
               'JS / Paws code sessions cleared for your nickname.',
            )
         },
         {allow_intentions: false},
      )

      this.register_command('topic', Shared.topic)
      this.register_command('find', Shared.find.bind(this))
      this.register_command(
         'learn',
         function (context) {
            if (context.sender.name === 'gqbrielle' || context.sender.name === 'mix') {
               var today = (new Date().getTime() / 86400) | 0

               if (this.gqLearnDay !== today) {
                  this.gqLearn = 0
                  this.gqLearnDay = today
               }

               if (this.gqLearn++ > 10) {
                  context.channel.send_reply(
                     context.sender,
                     "I think you've had enough for one day.",
                  )
               } else {
                  Shared.learn.apply(this, arguments)
               }
            } else {
               Shared.learn.apply(this, arguments)
            }
         },
         {allow_intentions: false},
      )
      this.register_command('forget', Shared.forget, {allow_intentions: false})
      this.register_command('commands', Shared.commands)
      this.register_command('g', Shared.google)

      this.register_command('sol', this.sol)

      var tinysong = function (context, song_name, number, cb) {
         var uri = 'http://tinysong.com/s/' + song_name.split(' ').join('+')
         console.log(uri)
         request(
            {
               uri: uri,
               json: true,
               encoding: 'utf8',
               qs: {
                  format: 'json',
                  limit: number,
                  key: '323d2374a9253c2bfc73fd0e6a461fb7',
               },
            },
            function (err, res, songs) {
               if (err || songs.error) {
                  console.log(err, songs.error)
                  context.channel.send_reply(context.sender, 'HTTP request failed. ):')
               } else if (songs.length === 0)
                  context.channel.send_reply(context.sender, 'Song not found. ):')
               else {
                  var reply = songs.map(function (song) {
                     return {
                        song: '“' + song.SongName + '”',
                        artist: song.ArtistName,
                        URI: '<' + song.Url + '>',
                     }
                  })
                  cb(reply)
               }
            },
         )
      }
      var listeningTo = function (context, text) {
         var reply
         tinysong(context, text, 1, function (reply) {
            if (/justin timberlake/i.test(reply[0].artist)) {
               return context.client.raw(
                  'KICK ' +
                     context.channel.name +
                     ' ' +
                     context.sender.name +
                     ' : NO JUSTIN TIMBERLAKE.',
               )
            }
            message =
               context.sender.name +
               ' is listening to ' +
               reply[0].song +
               ', by ' +
               reply[0].artist
            context.channel.send(message, {color: true})
            context.channel.send('(' + reply[0].URI + ')', {color: true})
         })
      }
      this.register_listener(/^♪\s+(.*)$/, function (ctx, _, text) {
         listeningTo(ctx, text)
      })
      this.register_command('listening', listeningTo)

      this.register_command('song', function (context, text) {
         var reply
         tinysong(context, text, 3, function (reply) {
            reply = reply
               .map(function (song) {
                  return song.song + ' by ' + song.artist + ': ' + song.URI
               })
               .join(', ')
            context.channel.send_reply(context.intent, reply, {color: true})
         })
      })

      var rule34 = function (context, key_words, cb) {
         var key_words = key_words
               .map(function (word) {
                  return word.split(/\s+/).join('_')
               })
               .join('+'),
            URI = 'http://rule34.paheal.net/post/list?search=' + key_words
         request(URI, function (err, resp, body) {
            if (err) return console.log(err)
            $ = cheerio.load(body)
            link = $(
               "#image-list .shm-image-list .thumb a:contains('Image Only')",
            ).first()
            if (link.length < 1) return console.log('No results for ' + key_words)
            request.get(
               {
                  uri: 'https://api-ssl.bitly.com/v3/shorten',
                  qs: {longUrl: $(link).attr('href'), access_token: BITLY_TOKEN},
                  json: true,
               },
               function (err, resp, body) {
                  if (err) return console.log(err)
                  cb('<' + body.data.url + '> [NSFW]')
               },
            )
         })
      }
      this.register_command('34', function (context, text) {
         if (!this.isDick(context)) return
         rule34(context, text.split(/\s*,\s*/), function (link) {
            context.channel.send_reply(context.intent, 'Here. ' + link, {color: true})
            context.channel.send_reply(
               context.sender,
               context.sender.name === context.intent.name
                  ? "... if you had any sense, you wouldn't have asked."
                  : "(You're a dick.)",
            )
         })
      })

      this.register_command('purr', function (context) {
         context.channel.send('...')
      })

      this.register_listener(/^\+what < *([^> ]+) *> +(.*)$/i, function (
         context,
         text,
         subject,
         object,
      ) {
         this.what.object.push('<' + subject + '> ' + object)
         this.what.activity()
         context.channel.send('beep.')
      })

      this.what.random = function (context) {
         if (!this.isDick(context)) return
         var a = this.what.object
         if (a.length > 0) {
            context.channel.send(a[(Math.random() * a.length) | 0])
         } else {
            context.channel.send_reply(context.sender, 'no data')
         }
      }
      this.register_command('what', this.what.random)

      this.register_command('best', function (context, text) {
         text = text.toUpperCase()
         var word = text.match(/[\s\x0F]*([^\s\x0F]+)$/)
         if (word) {
            word = word[1]
         } else {
            word = text
         }
         context.channel.send(text.replace(/\s+/g, '') + ' IS BEST' + word)
      })

      this.register_command('factoid', function (context, text) {
         var factoids = this.factoids.db.object.factoids,
            name = text.trim()
         var info = factoids[name]
         if (typeof info === 'undefined') {
            context.channel.send_reply(context.sender, 'Error: Factoid not found.')
         } else {
            if (typeof info.alias !== 'undefined') {
               context.channel.send_reply(context.sender, 'Alias: ' + info.alias)
            } else {
               var delta_time = '<unknown time>'
               if (typeof info.timestamp !== 'undefined') {
                  var relsol = new Sol().relativize(Sol.parseSol(info.timestamp, true))
                  delta_time = new Sol(
                     ((relsol.floating * 1000) | 0) / 1000,
                     false,
                  ).toString()
               }
               context.channel.send_reply(
                  context.intent,
                  'Popularity: ' +
                     info.popularity +
                     ', last changed by: ' +
                     `${info.modified_by || '<unknown>'}` +
                     ', ' +
                     delta_time +
                     ' ago',
               )
            }
         }
      })

      this.register_listener(/^\x0F\x0F(.+)/, function (context, text, code) {
         var result
         var last_invocation = this.last_invocation[context.sender.name]

         if (!context.sender.access) {
            var hours = 1000 * 60 * 60
            var now = +new Date()

            if (
               now > last_invocation + 3 * hours ||
               typeof last_invocation === 'undefined'
            ) {
               context.channel.send(
                  '*scolds ' + context.sender.name + ' and puts them in a time out.*',
               )
               this.last_invocation[context.sender] = now
            }
            return
         }

         try {
            result = eval_with_context(context, code)
         } catch (e) {
            context.channel.send_reply(context.sender, e)
            return
         }
         if (result != null) {
            context.channel.send_reply(
               context.sender,
               require('./purr-utils.js').pretty_print(result).substr(0, 400),
            )
         }
      })

      this.lollable = true
      this.drinkable = false
      this.register_listener(/\b(\w*lol\w*)\b/i, function (context, text, word) {
         if (this.lollable && this.isDick(context)) {
            this.lollable = false
            var self = this
            setTimeout(function () {
               self.lollable = true
            }, 3 * 60 * 1000)
            context.channel.send(this.drinkable ? word + ' (DRINK!)' : word)
         }
      })

      this.register_command('play', function (context) {
         this.drinkable = true
         context.channel.send("Let's play a game. It works like this:")
         context.channel.send_reply(context.intent, 'DRINK!')
      })

      this.register_listener(/[A-Z]\w+[A-Z]\w+ .*get along with.*/, function (context) {
         if (this.isDick(context)) context.channel.send('*shakes his head.*')
      })
      this.register_listener(/get along/, function (context) {
         if (this.isDick(context)) context.channel.send('hah')
      })

      this.register_listener(/\*shrug\*|shrugs/, function (context) {
         if (this.isDick(context)) context.channel.send('¯\\(º_o)/¯')
      })

      this.register_listener(/^\s*purr: i (?:like|love) you/i, function (context) {
         if (this.isDick(context))
            context.channel.send_reply(context.sender, 'thank you! ^_^')
      })

      this.comment = function (context) {
         var that = this
         if (!this.isDick(context)) return false
         if (!that.commented) {
            setTimeout(function () {
               delete that.commented
            }, 3 * 60 * 1000)
            that.commented = true
         }

         return that.commented
      }
      this.register_listener(/purr\b.*\bcatgirl/, function (context) {
         var that = this
         if (this.isDick(context) && !this.insulted) {
            this.commented = true
            setTimeout(function () {
               this.insulted = false
            }, 86400 * 1000)
            context.channel.send_reply(
               context.sender,
               'suck my cock. (relevant: because I have one)',
            )
         }
      })
      this.register_listener(
         /\bpurr\b.*\b(she|her)\b|\b(she|her)\b.*\bpurr\b/i,
         function (context, text, phrase) {
            var that = this
            text = text.replace(/^purr:/, '')
            if (this.comment(context)) {
               var responses = [],
                  match,
                  re = /(?:[^ ]+ )?\b(?:she|her)\b(?:[^ ]* [^ ]+)?/gi
               while ((match = re.exec(text)) !== null)
                  responses.push(
                     match[0].replace(/she/i, '*he*').replace(/her/i, '*his*'),
                  )
               context.channel.send_reply(context.sender, '... ' + responses.join(', '))
            }
         },
      )

      this.register_listener(
         /purr.*\b(?:hi|hello)\b|\b(?:hi|hello)\b.*purr|^\s*hi\s*$/i,
         function (context) {
            if (this.isDick(context)) context.channel.send_reply(context.sender, 'hi!')
         },
      )

      this.register_command('stop', function (context) {
         var now = +new Date()
         this.drinkable = false
         if (this.isDick(context)) {
            this.annoyban = +new Date()
            clearInterval(this.countdown_timer)
         }
      })

      this.register_command('start', function (context) {
         var that = this
         if (!this.isDick(context)) {
            delete this.annoyban
         }

         var what = function () {
            if (that.isDick(context)) that.what.random.call(that, context)
            setTimeout(what, Math.random() * 21600 * 1000)
         }
         if (!this.what.timerID)
            this.what.timerID = setTimeout(what, Math.random() * 172800 * 1000)
      })

      this.register_command('dick', function (context) {
         var now = +new Date()
         if (!this.isDick(context)) {
            var sol = new Sol((this.annoyban - now) / 86400000 + 1, false)
            context.channel.send_reply(
               context.intent,
               "I'll be a dick in " +
                  sol.toStupidString() +
                  ' (' +
                  sol.toString() +
                  '); please wait patiently.',
            )
         } else {
            context.channel.send_reply(context.intent, 'no. fuck you.')
         }
      })

      this.register_listener(
         /^\+\+\s*(.+)$/,
         function (context, text, loved) {
            this.love(context, context.sender.name, loved.trim(), +1)
         },
         {allow_intentions: false},
      )
      this.register_listener(
         /^([^\s]+)\s*\+\+$/,
         function (context, text, loved) {
            this.love(context, context.sender.name, loved.trim(), +1)
         },
         {allow_intentions: false},
      )

      this.register_listener(
         /^--\s*(.+)$/,
         function (context, text, loved) {
            this.love(context, context.sender.name, loved.trim(), -1)
         },
         {allow_intentions: false},
      )
      this.register_listener(
         /^([^\s]+)\s*--$/,
         function (context, text, loved) {
            this.love(context, context.sender.name, loved.trim(), -1)
         },
         {allow_intentions: false},
      )

      /* workaround for '-' prefix */
      this.register_command(
         '-',
         function (context, loved) {
            this.love(context, context.sender.name, loved.trim(), -1)
         },
         {allow_intentions: false},
      )

      this.register_listener(
         /^\u0ca0_\u0ca0 +(.+)$/,
         function (context, text, loved) {
            this.love(context, context.sender.name, loved.trim(), -1, {
               hate: ' disapproves of ',
               hard: true,
            })
         },
         {allow_intentions: false},
      )

      this.register_command('loves', function (context, text) {
         var t = this.loves.object[text.trim()]
         if (!t) {
            context.channel.send_reply(
               context.intent,
               text.trim() + " doesn't love anything :(",
            )
            return
         }
         var a = []
         for (var k in t) {
            if (t.hasOwnProperty(k) && t[k] > 0) {
               a.push(k)
            }
         }
         if (a.length == 0) {
            context.channel.send_reply(
               context.intent,
               text.trim() + " doesn't love anything :(",
            )
         } else if (a.length == 1) {
            context.channel.send_reply(
               context.intent,
               text.trim() + ' loves ' + a[0] + '.',
            )
         } else {
            last = a.pop()
            context.channel.send_reply(
               context.intent,
               text.trim() +
                  ' loves ' +
                  a.join(', ') +
                  (a.length == 1 ? '' : ',') +
                  ' and ' +
                  last +
                  '.',
            )
         }
      })

      this.register_command('hates', function (context, text) {
         var t = this.loves.object[text.trim()]
         if (!t) {
            context.channel.send_reply(
               context.intent,
               text.trim() + " doesn't hate anything :)",
            )
            return
         }
         var a = []
         for (var k in t) {
            if (t.hasOwnProperty(k) && t[k] < 0) {
               a.push(k)
            }
         }
         if (a.length == 0) {
            context.channel.send_reply(
               context.intent,
               text.trim() + " doesn't hate anything :)",
            )
         } else if (a.length == 1) {
            context.channel.send_reply(
               context.intent,
               text.trim() + ' hates ' + a[0] + '.',
            )
         } else {
            last = a.pop()
            context.channel.send_reply(
               context.intent,
               text.trim() +
                  ' hates ' +
                  a.join(', ') +
                  (a.length == 1 ? '' : ',') +
                  ' and ' +
                  last +
                  '.',
            )
         }
      })

      this.register_command('wholoves', function (context, text) {
         var l = this.loves.object
         var a = []
         var t = text.trim().toLowerCase()

         for (var n in l) {
            if (l.hasOwnProperty(n)) {
               for (var k in l[n]) {
                  if (l[n].hasOwnProperty(k) && l[n][k] == +1 && k.toLowerCase() == t)
                     a.push(n)
               }
            }
         }

         if (a.length == 0) {
            context.channel.send_reply(
               context.intent,
               text.trim() + ' is loved by no one :(',
            )
         } else if (a.length == 1) {
            context.channel.send_reply(
               context.intent,
               text.trim() + ' is loved by ' + a[0] + '.',
            )
         } else {
            last = a.pop()
            context.channel.send_reply(
               context.intent,
               text.trim() +
                  ' is loved by ' +
                  a.join(', ') +
                  (a.length == 1 ? '' : ',') +
                  ' and ' +
                  last +
                  '.',
            )
         }
      })

      this.register_command('whohates', function (context, text) {
         var l = this.loves.object
         var a = []
         var t = text.trim().toLowerCase()

         for (var n in l) {
            if (l.hasOwnProperty(n)) {
               for (var k in l[n]) {
                  if (l[n].hasOwnProperty(k) && l[n][k] == -1 && k.toLowerCase() == t)
                     a.push(n)
               }
            }
         }

         if (a.length == 0) {
            context.channel.send_reply(
               context.intent,
               text.trim() + ' is hated by no one :)',
            )
         } else if (a.length == 1) {
            context.channel.send_reply(
               context.intent,
               text.trim() + ' is hated by ' + a[0] + '.',
            )
         } else {
            last = a.pop()
            context.channel.send_reply(
               context.intent,
               text.trim() +
                  ' is hated by ' +
                  a.join(', ') +
                  (a.length == 1 ? '' : ',') +
                  ' and ' +
                  last +
                  '.',
            )
         }
      })

      this.countdown_timer = null

      this.register_command('countdown', function (context, text) {
         if (this.isDick(context)) {
            var length,
               decrement,
               self = this

            if (text === 'stop') {
               return clearInterval(this.countdown_timer)
            }

            length = parseFloat(text, 10)
            if (isNaN(length)) {
               length = text.length
            }
            if (length > 30) {
               length = 30
            }
            if (length < -30) {
               length = -30
            }

            decrement = length / Math.abs(Math.round(length))
            if (!isFinite(decrement)) decrement = length

            clearInterval(this.countdown_timer)
            this.countdown_timer = setInterval(function () {
               if (length > 0.1 || length < -0.1) {
                  context.channel.send(String(((length * 1000) | 0) / 1000) + '...')
               } else {
                  context.channel.send('Go!')
                  clearInterval(self.countdown_timer)
               }
               length -= decrement
            }, 1000)
         }
      })

      this.on('command_not_found', this.find)

      this.queue = []
      this.register_command('queue', function (context, text) {
         this.queue.push([context.sender, text])
      })
      this.register_command('dequeue', function (context, text) {
         var item = text !== 'peek' ? this.queue.shift() : this.queue[0]
         if (item) {
            context.channel.send('<' + item[0].name + '> ' + item[1])
         } else {
            context.channel.send_reply(context.sender, 'The queue is empty.')
         }
      })

      this.queue = {}
      this.register_command('queue', function (context, text) {
         var who = context.intent.name
         if (!this.queue[who]) this.queue[who] = []
         this.queue[who].push([context.sender, text])
      })
      this.register_command('dequeue', function (context, text) {
         var who = context.intent.name
         if (!this.queue[who]) this.queue[who] = []
         var item = text == 'peek' ? this.queue[who][0] : this.queue[who].shift()
         if (item) {
            context.channel.send_reply(
               context.intent,
               '<' + item[0].name + '> ' + item[1],
            )
         } else {
            context.channel.send_reply(context.sender, 'The queue is empty.')
         }
      })

      this.register_listener(/^::([^>].*)+/, function (context, text, code) {
         var session = this.code_sessions[context.sender.name]
         if (typeof session === 'undefined') {
            this.eval_paws(context, code, function (evaled) {
               // TODO
            })
         } else {
            clearTimeout(session.timeout)
            this.eval_paws(context, session.code + code, function (evaled) {
               // TODO
            })
            delete this.code_sessions[context.sender.name]
         }
      })

      // I am ashamed of this code. Please kill me. -devyn

      this.register_listener(/^bf> (.*)/, function (context, _, code) {
         /*
          * var context = {channel: {send_reply: function(_, msg) { console.log(msg); }}};
          * module.exports.bf = function(code) {
          * */

         var startTime = Date.now()

         var memZeroPos = [0],
            memNeg = [],
            curCell = 0,
            curChr = 0,
            jumpStack = [],
            input = '',
            inputPos = 0,
            output = ''
         code = code.replace(/!(.*)$/, function (_, match) {
            input = match
            return ''
         })

         for (; Date.now() - startTime <= 15000 && curChr < code.length; curChr++) {
            switch (code[curChr]) {
               case '>':
                  curCell++
                  if (curCell >= 0) {
                     if (typeof memZeroPos[curCell] === 'undefined')
                        memZeroPos[curCell] = 0
                  } else {
                     if (typeof memNeg[-curCell - 1] === 'undefined')
                        memNeg[-curCell - 1] = 0
                  }
                  break
               case '<':
                  curCell--
                  if (curCell >= 0) {
                     if (typeof memZeroPos[curCell] === 'undefined')
                        memZeroPos[curCell] = 0
                  } else {
                     if (typeof memNeg[-curCell - 1] === 'undefined')
                        memNeg[-curCell - 1] = 0
                  }
                  break
               case '+':
                  if (curCell >= 0) {
                     memZeroPos[curCell]++
                  } else {
                     memNeg[-curCell - 1]++
                  }
                  break
               case '-':
                  if (curCell >= 0) {
                     memZeroPos[curCell]--
                  } else {
                     memNeg[-curCell - 1]--
                  }
                  break
               case '[':
                  jumpStack.push(curChr)
                  break
               case ']':
                  if (
                     parseInt(
                        curCell >= 0 ? memZeroPos[curCell] : memNeg[-curCell - 1],
                        10,
                     ) == 0
                  ) {
                     jumpStack.pop()
                  } else {
                     curChr = jumpStack[jumpStack.length - 1]
                  }
                  break
               case ',':
                  if (curCell >= 0) {
                     memZeroPos[curCell] =
                        inputPos < input.length ? input.charCodeAt(inputPos++) : 0
                  } else {
                     memNeg[-curCell - 1] =
                        inputPos < input.length ? input.charCodeAt(inputPos++) : 0
                  }
                  break
               case '.':
                  output += String.fromCharCode(
                     curCell >= 0 ? memZeroPos[curCell] : memZeroPos[-curCell - 1],
                  )
                  break
            }
         }

         if (Date.now() - startTime > 15000) {
            context.channel.send_reply(context.sender, 'Timeout exceeded.')
            return
         }

         var memoryString = ''

         for (var i = memNeg.length - 1; i >= 0; i--) {
            if (-i - 1 == curCell) {
               memoryString += '[' + parseInt(memNeg[i], 10) + '] '
            } else {
               memoryString += '' + parseInt(memNeg[i], 10) + ' '
            }
         }
         for (var j = 0; j < memZeroPos.length; j++) {
            if (j == curCell) {
               memoryString += '[' + parseInt(memZeroPos[j], 10) + '] '
            } else {
               memoryString += '' + parseInt(memZeroPos[j], 10) + ' '
            }
         }

         if (output) {
            context.channel.send_reply(
               context.intent,
               memoryString.replace(/ $/, '. ') + 'Output: ' + JSON.stringify(output),
            )
         } else {
            context.channel.send_reply(context.intent, memoryString)
         }

         //}
      })

      //    var kicked = {};
      //
      //    this.register_command ("kick", function(context, text) {
      //  if (this.isDick(context)) {
      //            var channel = context.channel, userlist, client = context.client;
      //
      //            if (context.priv) {
      //      return channel.send_reply (context.sender, "Must be in the channel to !kick.");
      //            }
      //
      //            userlist = channel.userlist;
      //            if (text.toLowerCase () === "everyone") {
      //      return channel.send_reply (context.sender, "Ha! Do I *look* like alexgordon?");
      //            } else if (userlist.hasOwnProperty(text)) {
      //      client.raw (
      //                    "KICK "+context.channel.name+" "+text+
      //          " :purr doesn't like you.");
      //            } else {
      //      return channel.send_reply (context.sender, "No one named `"+text+"` in the channel.");
      //            }
      //  }
      //    });

      this.register_command('twister', function (context) {
         if (this.isDick(context)) {
            context.channel.send(
               rand(['Left ', 'Right ']) +
                  rand(['foot on ', 'hand on ']) +
                  rand(['red!', 'yellow!', 'green!', 'blue!']),
            )
         }

         function rand(a) {
            return a[(Math.random() * a.length) | 0]
         }
      })
   }

   find(context, text) {
      if (context.priv) {
         return Shared.find(context, text)
      }

      try {
         context.channel.send_reply(context.intent, this.factoids.find(text, true), {
            color: true,
         })
      } catch (e) {
         // Factoid not found, do nothing.
      }
   }

   Flags(text) {
      var m = text.match(/^-([^ ]+)( (.+))?/)
      if (m) {
         var s = m[1].split('')
         return {
            all: s,
            flags: s.reduce(function (o, i) {
               o[i] = true
               return o
            }, {}),
            args: m[2] ? m[3] : null,
         }
      } else {
         return null
      }
   }

   sol(context, text) {
      if (text) {
         var f = Flags(text)
         if (f) {
            if (f.flags.r && f.all.length == 2) {
               if (f.flags.s && f.args) {
                  // to relative gregorian from relative sol
                  return context.channel.send_reply(
                     context.intent,
                     Sol.parseSol(f.args, false).toStupidString(),
                  )
               } else if (f.flags.g && f.args) {
                  // to relative sol from relative gregorian
                  return context.channel.send_reply(
                     context.intent,
                     Sol.parseStupid(f.args, false).toString(),
                  )
               }
            } else if (f.flags.a && f.all.length == 2) {
               if (f.flags.s && f.args) {
                  // add a relative UJD to the current time and return the result in gregorian time
                  return context.channel.send_reply(
                     context.intent,
                     new Sol(
                        new Sol().floating + Sol.parseSol(f.args).floating,
                     ).toStupidString(),
                  )
               } else if (f.flags.g && f.args) {
                  // add a relative gregorian time to the current time and return the result as a UJD
                  return context.channel.send_reply(
                     context.intent,
                     new Sol(
                        new Sol().floating + Sol.parseStupid(f.args).floating,
                     ).toString(),
                  )
               }
            } else if (f.all.length == 1) {
               if (f.flags.s && f.args) {
                  // to absolute gregorian from absolute sol
                  return context.channel.send_reply(
                     context.intent,
                     Sol.parseSol(f.args, true).toStupidString(),
                  )
               } else if (f.flags.g && f.args) {
                  // to absolute sol from absolute gregorian
                  return context.channel.send_reply(
                     context.intent,
                     Sol.parseStupid(f.args, true).toString(),
                  )
               } else if (f.flags.h) {
                  var s = context.sender
                  s.send(
                     '----------------------------[ !sol command usage ]-----------------------------',
                  )
                  s.send('-sol')
                  s.send('  Outputs the current time in the Unix-Julian Date format.')
                  s.send('-sol -g <time>')
                  s.send('  Converts an ISO 8601 Gregorian time to UJD.')
                  s.send('-sol -gr <amount>')
                  s.send(
                     '  Converts a relative Gregorian amount (e.g. 8 months) to the equivalent',
                  )
                  s.send('  measurement in sols (ſ).')
                  s.send('-sol -ga <amount>')
                  s.send(
                     '  Outputs the current time in UJD, advanced by <amount> specified in Gregorian',
                  )
                  s.send('  measurements.')
                  s.send('-sol -s <time>')
                  s.send(
                     '  Converts a Unix-Julian Date to the conventional Gregorian format.',
                  )
                  s.send('-sol -sr <amount>')
                  s.send(
                     '  Converts an amount measured in sols (ſ) to a Gregorian-based amount.',
                  )
                  s.send('-sol -sa <amount>')
                  s.send(
                     '  Outputs the current UTC time in Gregorian, advanced by <amount> sols (ſ).',
                  )
                  s.send(
                     '-------------------------------------------------------------------------------',
                  )
                  return
               }
            }
         }
      } else {
         // current time in UJD
         return context.channel.send_reply(context.intent, new Sol().toString())
      }
      context.channel.send_reply(
         context.sender,
         "Invalid usage. If you invoke `-sol -h`, I'll PM you with instructions on how to use -sol.",
      )
   }

   isDick(context) {
      if (
         typeof context === 'undefined' ||
         context.priv ||
         context.channel.name === '#purr' ||
         context.channel.name === '#elliottcable' ||
         context.channel.name === '#chats'
      ) {
         var now = +new Date()
         return this.annoyban == undefined || this.annoyban < now - 1000 * 60 * 60 * 24
      } else {
         return false
      }
   }

   love(context, lover, loved, d, opts) {
      var opts = merge(
         {love: ' loves ', hate: ' hates ', zero: ' is indifferent to ', hard: false},
         opts,
      )
      var l = this.loves.object
      if (!l[lover]) l[lover] = {}
      var c = opts.hard ? 0 : l[lover][loved] || 0

      if (
         (c == 0 || c == 1) &&
         d == 1 &&
         loved.match(new RegExp('^' + lover + '$', 'i'))
      ) {
         if (this.isDick(context))
            context.channel.send(
               'Let it be known that ' + lover + ' is an egotistical prick.',
            )
         return
      }

      if (d == -1 && loved.match(/^purr/i)) {
         if (this.isDick(context)) context.channel.send(lover + '-- (... dickface.)')
         return
      }

      if ((c == 0 || c == 1) && d == 1 && loved.match(/^php$/i)) {
         if (this.isDick(context))
            context.channel.send(lover + ": I think you meant '-- PHP'.")
         c = 0
         d = -1
      }

      if (c + d > 0) {
         if (this.isDick(context))
            context.channel.send(
               'Let it be known that ' + lover + opts.love + loved + '.',
            )
         l[lover][loved] = +1
      } else if (c + d < 0) {
         if (this.isDick(context))
            context.channel.send(
               'Let it be known that ' + lover + opts.hate + loved + '.',
            )
         l[lover][loved] = -1
      } else {
         if (this.isDick(context))
            context.channel.send(
               'Let it be known that ' + lover + opts.zero + loved + '.',
            )
         delete l[lover][loved]
      }
      this.loves.activity()
   }

   eval_priv(context, command, code) {
      if (context.sender.access) {
         try {
            result = eval_with_context(context, code)
         } catch (e) {
            context.channel.send_reply(context.sender, e)
            return
         }
         if (result != null) {
            context.channel.send_reply(
               context.sender,
               require('./purr-utils.js').pretty_print(result).substr(0, 400),
            )
         }
      } else {
         Shared.execute_js.call(this, context, '', command, code)
      }
   }

   code_session(name) {
      var sess,
         sessions = this.code_sessions,
         timeout = setTimeout(function () {
            delete sessions[name]
         }, this.code_session_timeout * 1000)
      if ((sess = sessions[name]) == null)
         return (sessions[name] = {timeout: timeout, code: ''})
      clearTimeout(sess.timeout)
      sess.timeout = timeout
      return sess
   }

   clear_code_session(name) {
      var sessions = this.code_sessions,
         sess = sessions[name]
      if (sess != null) {
         delete sessions[name]
         clearTimeout(sess.timeout)
         if (sess.world) sess.world.stop() // TODO: This needs a proper timeout/kill.
         return sess
      }
   }

   // TODO: This should be DRY'd up by generalizing paws.REPL
   // TODO: Currently assumes single-line, multi-expression. Support multi-line with `void`.
   eval_paws(ctx, code, cb) {
      var obj,
         sess = this.code_session(ctx.sender.name)

      if (code.length > 0) {
         if (sess.world == null) {
            sess.world = new paws.World()
            sess.world.start()

            sess.globals = paws.Execution(new Function())
            obj = {
               implementation: {
                  stop: paws.implementation.stop,
                  util: {
                     test: paws.Execution(function () {
                        ctx.channel.send_reply(ctx.sender, 'test successful!')
                     }),
                     print: paws.Execution(function (label) {
                        ctx.channel.send_reply(ctx.sender, label.string)
                     }),
                     inspect: paws.Execution(function (thing) {
                        ctx.channel.send(thing.inspect(), {color: true})
                     }),
                  },
                  void: paws.implementation.void,
               },
            }
            obj.impl = obj.implementation
            obj.infra = paws.infrastructure
            sess.world.applyGlobals(sess.globals, obj)
            sess.globals = sess.globals.locals
         }

         var expr = new paws.Expression(paws.implementation.void),
            lines = code.split('\n').forEach(function (line) {
               expr.append(new paws.Expression(paws.cPaws.parse(line)))
            }),
            exe = new paws.Execution(expr).name('<IRC eval>')
         exe.locals = sess.globals

         sess.world.stage(exe)
      }
   }
}

var profile = require('./purr-profile.js')
new Purr(profile).init()
