// This is for common functions defined in many bots at once
var Sandbox = require('./lib/sandbox')
var FeelingLucky = require('./lib/feelinglucky')

function parse_regex_literal(text) {
   var regexparsed = text.match(/s\/((?:[^\\\/]|\\.)*)\/((?:[^\\\/]|\\.)*)\/([gi]*)$/)
   if (!regexparsed) {
      throw new SyntaxError('Syntax is `s/expression/replacetext/gi`.')
   }

   var regex = new RegExp(regexparsed[1], regexparsed[3])
   return [regex, regexparsed[2].replace(/\\\//g, '/')]
}

var old_topics = {}

var Shared = (module.exports = {
   google: function (context, text) {
      FeelingLucky(text, function (data) {
         if (data) {
            context.send_to_intents(
               '\x02' + data.title + '\x0F \x032<' + data.url + '>\x0F',
               {color: true},
            )
         } else {
            context.send_reply('No search results found.')
         }
      })
   },

   execute_js: function (context, text, command, code) {
      var engine

      switch (command) {
         case 'sm>':
         case 's>':
            context.send_reply(
               'Sorry, but the SpiderMonkey engine is not working — please use v8> or >>>.',
            )
            return
         //engine = Sandbox.SpiderMonkey; break;
         default:
            engine = Sandbox.V8
            break
      }
      this.sandbox.run(
         engine,
         2000,
         code,
         function (result) {
            var reply

            try {
               /* If theres an error, show that.
                   If not, show the type along with the result */
               if (result.error !== null) {
                  reply = result.error
               } else {
                  if (result.data.type !== 'undefined') {
                     reply =
                        (result.data.obvioustype ? '' : '(' + result.data.type + ') ') +
                        result.result
                  } else {
                     reply = 'undefined'
                  }
               }

               if (Array.isArray(result.data.console) && result.data.console.length) {
                  // Add console log output
                  reply += '; Console: ' + result.data.console.join(', ')
               }

               context.send_to_intents(reply, {truncate: true})
            } catch (e) {
               context.send_to_intents('Unforeseen Error: ' + e.name + ': ' + e.message)
            }
         },
         this,
      )
   },

   learn: function (context, text) {
      try {
         var parsed = text.match(/^(alias)?\s*(.+?)\s*(=~?)\s*(.+)$/i)
         if (!parsed) {
            throw new SyntaxError(
               'Syntax is `learn ( [alias] foo = bar | foo =~ s/expression/replace/gi )`.',
            )
         }

         var alias = !!parsed[1]
         var factoid = parsed[2]
         var operation = parsed[3]
         var value = parsed[4]

         if (alias) {
            var key = this.factoids.alias(factoid, value)
            context.send_reply('Learned `' + factoid + '` => `' + key + '`.')
            return
         }

         /* Setting the text of a factoid */

         if (operation === '=') {
            this.factoids.learn(factoid, value, context.sender)
            context.send_reply('Learned `' + factoid + '`.')
            return

            /* Replacing the text of a factoid based on regular expression */
         } else if (operation === '=~') {
            var regexinfo = parse_regex_literal(value)
            var regex = regexinfo[0]
            var old = this.factoids.find(factoid, false)
            var result = old.replace(regex, regexinfo[1])

            if (old === result) {
               context.send_reply('Nothing changed.')
            } else {
               this.factoids.learn(factoid, result, context.sender)
               context.send_reply('Changed `' + factoid + '` to: ' + result)
            }
            return
         }
      } catch (e) {
         context.send_reply(e)
      }
   },

   forget: function (context, text) {
      try {
         this.factoids.forget(text)
         context.send_reply("Forgot '" + text + "'.")
      } catch (e) {
         context.send_reply(e)
      }
   },

   commands: function (context, text) {
      var commands = this.get_commands()
      var trigger = this.__trigger
      context.send_to_intents(
         'Valid commands are: ' + trigger + commands.join(', ' + trigger),
      )
   },

   find: function (context, text) {
      try {
         context.send_to_intents(this.factoids.find(text, true))
      } catch (e) {
         var reply = ['Could not find `' + text + '`.'],
            found = this.factoids.search(text)

         found = found.map(function (item) {
            return '\x033' + item + '\x0F'
         })

         if (found.length) {
            reply = ['Found:']
            if (found.length > 1)
               found[found.length - 1] = 'and ' + found[found.length - 1]
            reply.push(found.join(found.length - 2 ? ', ' : ' '))
         }

         context.send_to_intents(reply.join(' '), {color: true})
      }
   },

   topic: function (context, text) {
      try {
         if (text) {
            if (text === 'revert') {
               var oldtopic = old_topics[context.channel.id]
               if (oldtopic) {
                  set_topic(oldtopic)
                  return
               } else {
                  throw new Error('No topic to revert to.')
               }
            }

            var regexinfo = parse_regex_literal(text)
            var regex = regexinfo[0]

            var topic = context.channel.topic.replace(regex, regexinfo[1])
            if (topic === context.channel.topic) throw new Error('Nothing changed.')

            set_topic(topic.replace(/\n/g, ' ')).catch(function (e) {
               context.send_reply(e)
            })
            //context.channel.set_topic(topic);
         } else {
            context.send_to_intents(context.channel.topic)
         }
      } catch (e) {
         context.send_reply(e)
      }

      function set_topic(topic) {
         old_topics[context.message.channel.id] = context.channel.topic
         context.send_reply(`Setting the topic to: ${topic}`)
         return context.channel.setTopic(topic)
      }
   },
})
