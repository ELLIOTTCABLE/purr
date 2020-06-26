var util = require('util')
var events = require('events')

var discord = require('discord.js')

var utilities = {
   escape_regex: (function () {
      var cache = {}
      return function (string) {
         if (typeof cache[string] !== 'undefined') return cache[string]
         cache[string] = string.replace(/[.*+?|()\\[\\]{}\\\\]/g, '\\$&')
         return cache[string]
      }
   })(),
   merge: function (defaults, options) {
      if (typeof options === 'undefined') return defaults
      var o = {}
      for (var i in defaults) {
         if (defaults.hasOwnProperty(i)) {
            o[i] = typeof options[i] === 'undefined' ? defaults[i] : options[i]
         }
      }
      return o
   },
   get_intents_from_message: function (message) {
      if (message.mentions && message.mentions.users) {
         return Array.from(message.mentions.users.values())
      }
   },
}

/**
 * events:
 *   'command_not_found': function (channel, user, command);
 **/
class Bot extends events.EventEmitter {
   constructor(profile) {
      super()

      this.__profile = profile
      this.__listening = []

      // Used to identify message as command for bot
      this.__trigger = '!'

      this.__log_level = this.LOG_NONE

      this.__commands = {}
      this.__commands_regex = null
      this.__trigger_changed = true

      process.on('uncaughtException', function (err) {
         process.stderr.write('\n' + err.stack + '\n\n')
      })
   }

   init() {
      var client = new discord.Client()

      this.__client = client

      client.on('ready', this.listeners.ready.bind(this))

      client.on('message', this.listeners.message.bind(this))

      this.log(this.LOG_CONNECT, 'Connecting...')

      client.login(this.__profile.token)
   }

   LOG_NONE = 0 // No logging
   LOG_CONNECT = 1 // Log server connections
   LOG_READY = 1 // Log server connections
   LOG_COMMANDS = 4 // Log messages triggering commands
   LOG_LISTENS = 8 // Log messages matching listeners
   LOG_OUTGOING = 16 // Log anything the bot sends
   LOG_INCOMING = 32 // Log anything the bot receives
   LOG_UNKNOWN = 64 // Log unknown commands received from the server

   LOG_ALL = -1 // Log everything

   log(level, message) {
      var d = new Date(),
         h = d.getHours(),
         k = h % 12,
         m = d.getMinutes(),
         s = d.getSeconds(),
         time =
            (k ? k : 12) +
            ':' +
            (m < 10 ? '0' + m : m) +
            ':' +
            (s < 10 ? '0' + s : s) +
            (h > 11 ? 'pm' : 'am')

      if (arguments.length > 2)
         message = Array.prototype.slice.call(arguments, 1).join(' ')
      if (this.__log_level == this.LOG_ALL || level & this.__log_level)
         console.log(time + ' ' + message)
   }

   set_log_level(level) {
      this.__log_level = level
   }

   /**
    * Listens for message matching the specified regex and calls the callback
    * function with:
    *
    * callback(context, text, 1st subpattern, 2nd subpattern, ...);
    **/
   register_listener(regex, callback, options) {
      this.__listening.push({
         regex: regex,
         callback: callback,
         options: utilities.merge(
            {
               allow_intentions: true, // Parse `@ nick` after message
            },
            options,
         ),
      })
   }

   /**
    * Add a new command to listen for: callback is called with (context, result)
    *  - result: the text that comes after the command
    **/
   register_command(command, callback, options) {
      command = command.toLowerCase()

      switch (typeof callback) {
         case 'function':
            this.__commands[command] = {
               callback: callback,
               options: utilities.merge(
                  {
                     allow_intentions: true, // Parse `@ nick` after message
                     hidden: false, // Show command in results from get_commands()
                     help: 'No help for `' + command + '`',
                  },
                  options,
               ),
            }
            break
         case 'string':
            callback = callback.toLowerCase()

            if (this.__commands.hasOwnProperty(callback)) {
               // The command is going to be an alias to `callback`
               this.__commands[command] = this.__commands[callback]
            } else {
               throw new Error(
                  'Cannot alias `' +
                     command +
                     '` to non-existant command `' +
                     callback +
                     '`',
               )
            }
            break
         default:
            throw new Error(
               'Must take a function or string as second argument to register_command',
            )
      }
   }

   /**
    * compile_commands: Compiles a RegExp object
    * ahead-of-time to listen for commands.
    **/
   compile_command_listener() {
      if (this.__trigger_changed) {
         var identifier = utilities.escape_regex(this.__trigger)
         this.__commands_regex = new RegExp(
            '^\\s*' + identifier + '\\s*((\\S+)\\s*(.*))$',
         )
      }
   }

   get_commands() {
      var array = []
      for (var i in this.__commands) {
         if (this.__commands.hasOwnProperty(i)) {
            if (!this.__commands[i].options.hidden) array.push(i)
         }
      }
      return array.sort()
   }

   get_command_help(command) {
      if (this.__commands.hasOwnProperty(command)) {
         return this.__commands[command].options.help
      }
      throw new Error('`' + command + '` is not a command.')
   }

   // Set the character that you use to signal a command to the bot
   set_trigger(c) {
      this.__trigger = c
      this.__trigger_changed = true
   }

   quit() {
      process.exit()
   }

   listeners = {
      ready: function () {
         this.log(this.LOG_READY, 'Connected and ready!')
      },
      message: function (message) {
         this.log(this.LOG_INCOMING, util.inspect(message))

         var client = this.__client
         var trimmed = message.content.trim()

         var context = {
            message: message,
            sender: Object.assign({author: message.author}, message.author),
            apply_options: function (text, options) {
               if (typeof options !== 'object') options = {}

               if (typeof options.color === 'undefined') options.color = false
               if (typeof options.control === 'undefined') options.control = false

               if (typeof options.truncate === 'undefined') options.truncate = false
               if (typeof options.maxlength === 'undefined') options.maxlength = 382
               if (typeof options.maxlines === 'undefined') options.maxlines = 1
               if (typeof options.truncmsg === 'undefined') options.truncmsg = '\u2026'

               // First we split the message by each line
               var lines = String(text).split(/[\r\n]+/g)

               // Then we get the number of lines we will output
               var linenums = options.truncate
                  ? Math.min(options.maxlines, lines.length)
                  : lines.length

               for (var i = 0; i < linenums; i++) {
                  if (lines[i].length) {
                     if (options.truncate) {
                        var realsize = options.maxlength - options.truncmsg.length
                        if (lines[i].length > options.maxlength) {
                           lines[i] = lines[i].substr(0, realsize) + options.truncmsg
                        }
                     }
                  }
               }

               return lines.join('\n')
            },
            send_dm: function (text, options) {
               var user = client.users.cache.get(message.author.id)
               user.send(this.apply_options(text, options))
            },
            send_to_intents: function (text, options) {
               if (this.intents) {
                  text = `${this.intents.map((user) => `${user}`).join(' ')}: ${text}`
               }
               this.send(text, options)
            },
            send_reply: function (text, options) {
               this.send(`${message.author}: ${text}`, options)
            },
         }

         switch (message.channel.type) {
            case 'dm':
               context.priv = true
               context.intents = [message.author]
               context.send = context.send_dm

               // Check if message matches listeners
               for (var i = 0, len = this.__listening.length; i < len; i++) {
                  var result = trimmed.match(this.__listening[i].regex)
                  if (result) {
                     this.__listening[i].callback.apply(
                        this,
                        [context, trimmed].concat(result.slice(1)),
                     )

                     return
                  }
               }

               this.compile_command_listener()

               var command_matches
               if ((command_matches = trimmed.match(this.__commands_regex))) {
                  var full = command_matches[1]
                  var command = command_matches[2].toLowerCase()
                  var parameters = command_matches[3]

                  if (this.__commands.hasOwnProperty(command)) {
                     this.__commands[command].callback.call(
                        this,
                        context,
                        parameters,
                        command,
                     )
                  } else {
                     this.emit('command_not_found', message, full)
                  }
               }

               break

            case 'text':
               this.compile_command_listener()

               var command_matches = trimmed.match(this.__commands_regex)
               var intents = utilities.get_intents_from_message(message)

               context.priv = false
               context.send = function (text, options) {
                  var channel = client.channels.cache.get(message.channel.id)
                  channel.send(this.apply_options(text, options))
               }

               context.guild = client.guilds.cache.get(context.message.channel.guild.id)
               context.channel = context.guild.channels.cache.get(
                  context.message.channel.id,
               )
               context.sender.member = context.guild.members.cache.get(context.sender.id)
               context.sender.nickname = context.sender.member.nickname

               if (command_matches) {
                  var full = command_matches[1]
                  var command = command_matches[2].toLowerCase()
                  var parameters = command_matches[3]

                  if (intents) {
                     context.intents = intents
                  }

                  /**
                   * TODO: Great I spilled something.. somehow make this DRY..
                   **/

                  if (this.__commands.hasOwnProperty(command)) {
                     if (intents && this.__commands[command].options.allow_intentions) {
                        context.intents = intents
                     }
                     this.__commands[command].callback.call(
                        this,
                        context,
                        parameters,
                        command,
                     )
                  } else {
                     if (intents) {
                        context.intents = intents
                     }
                     this.emit('command_not_found', context, full)
                  }
                  return
               }

               // Check if message matches listeners
               for (var i = 0, len = this.__listening.length; i < len; i++) {
                  if (this.__listening[i].options.allow_intentions) {
                     if (intents) {
                        context.intents = intents
                     }
                  }

                  var result = trimmed.match(this.__listening[i].regex)
                  if (result) {
                     this.__listening[i].callback.apply(
                        this,
                        [context, trimmed].concat(result.slice(1)),
                     )
                  }
               }

               break
         }
      },
   }
}

module.exports = Bot
