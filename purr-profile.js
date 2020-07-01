module.exports = {
   token: process.env['PURR_DISCORD_TOKEN'],
   access_roles: new Set((process.env['PURR_ACCESS_ROLES'] || '').split(':')),
   pg_url: process.env['DATABASE_URL'],
   web_port: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 8080,
}
