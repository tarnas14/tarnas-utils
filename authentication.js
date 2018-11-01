const passport = require('passport')
const google = require('passport-google-oauth').OAuth2Strategy
const path = require('path')

const myAmazingDb = {}

module.exports = {
  routes: (app) => {
    app.get('/auth/login', (req, res) => res.redirect('/auth/google'))
    app.get('/auth/google', passport.authenticate('google', { scope: 'email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file' }))
    app.get(
      '/auth/callback',
      passport.authenticate('google'),
      // https://github.com/jaredhanson/passport-google-oauth2/issues/15
      (err, req, res, next) => {
        if (err.name === 'TokenError') {
          res.redirect('/auth/google')
          return
        }

        next(err, req, res)
      },
      (req, res) => res.redirect('/'),
    )
  },
  setup: (app) => {
    const pg = app.locals.pg

    // -- Setting up Passport --
    passport.use(new google(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_SECRET,
        userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo', // to avoid google plus API: https://github.com/jaredhanson/passport-google-oauth2/issues/7
        callbackURL: '/auth/callback',
      },
      (accessToken, refreshToken, profile, done) => {
        if (!myAmazingDb[profile.id]) {
          myAmazingDb[profile.id] = {
            profile,
            accessToken
          }
        }

        done(null, myAmazingDb[profile.id])
      },
    ))

    passport.serializeUser((userData, done) => done(null, userData.profile.id))
    passport.deserializeUser((id, done) => done(null, myAmazingDb[id]))

    app.use(passport.initialize())
    app.use(passport.session())

    // -- Setting up middleware for all views of the website --
    app.use((req, res, next) => {
      // Whitelist
      if (req.path.startsWith('/auth')) {
        next()
        return
      }

      if (!req.isAuthenticated || !req.isAuthenticated()) {
        res.redirect('/auth/login')
        return
      }

      next()
    })
  },
}
