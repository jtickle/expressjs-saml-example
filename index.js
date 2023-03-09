const express = require('express')
const expressSession = require('express-session')
const dotenv = require('dotenv')
const bodyParser = require('body-parser')
const passport = require('passport')
const SamlStrategy = require('passport-saml').Strategy
const morgan = require('morgan')
const fs = require('fs')
const { nextTick } = require('process')

// Add in variables from possible .env file to process.env
dotenv.config()

// Create ExpressJS app
const app = express()

// Set up Access Logging (not strictly necessary for SAML)
app.use(morgan('combined'))

// Create ExpressJS Session. This is really unnecessary to just get a token
// to the client, but the overhead is required by passport-saml.
app.use(expressSession({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}))

// Initialize Passport authentication and add middleware to Express app
app.use(passport.initialize())
app.use(passport.session())

// Read SAML certificate/key files
const idpCert = fs.readFileSync(process.env.SAML_IDP_CERT, 'utf8')
const spDecryptionKey = fs.readFileSync(process.env.SAML_SP_DECRYPTION_KEY, 'utf8')
const spDecryptionCert = fs.readFileSync(process.env.SAML_SP_DECRYPTION_CERT, 'utf8')
const spSigningKey = fs.readFileSync(process.env.SAML_SP_SIGNING_KEY, 'utf8')
const spSigningCert = fs.readFileSync(process.env.SAML_SP_SIGNING_CERT, 'utf8')

// Set up SAML configuration for passport-saml
const samlOptions = {
  path: '/auth/saml/sso',
  entryPoint: process.env.SAML_IDP_LOGIN_URL,
  logoutUrl: process.env.SAML_IDP_LOGOUT_URL,
  issuer: process.env.SAML_ISSUER,
  cert: idpCert,
  decryptionPvk: spDecryptionKey,
  privateKey: spSigningKey,
  forceAuthn: false,
}

// Create SAML Strategy for Passport
const samlStrategy = new SamlStrategy(samlOptions, function (profile, done) {
  // In here we can process the data returned from the Identity provider.
  // Perhaps you want to enrich the user data from a local database, or
  // create a permanent record in that local database for a new user.
  console.log(profile)
  // The second paramter to the `done` function is the user data that
  // will be stored into the session, later available from `req.user`
  done(null, {
    nameID: profile.nameID,
    nameIDFormat: profile.nameIDFormat,
    mail: profile.mail || profile.email,
    attributes: profile.attributes,
    cloudToken: process.env.CLOUD_SECRET
  })
})

// Add SAML Strategy to Passport
passport.use(samlStrategy)

// These functions are necessary for Passport in order to serialize
// the live user data into the session. Probably can be unmodified.
passport.deserializeUser(function (user, done) {
  done(null, user)
})
passport.serializeUser(function (user, done) {
  done(null, user)
})

// Initiate SAML Login. This ALWAYS results in the user being sent to
// the Identity Provider. If the user already has an IdP session, they
// will very quickly be sent back to /auth/saml/sso with user data.
// Otherwise, they leave your app and enter credentials and are sent
// back if successful. (Note, if unsuccessful, they are never sent back.)
app.use('/login', passport.authenticate('saml'))

// Initiate SAML Single Logout. Not every IdP supports SLO. So, there
// is some logic to try IdP SLO, and if it fails, fallback to local
// logout. Either way, after SLO is complete, it terminates the local
// user session by redirecting to /auth/saml/slo.
app.use('/logout', function(req, res, next) {
  if(!req.user) return next('You were not already logged in.')
  //try {
    samlStrategy.logout(req, function(error, sloUrl) {
      if(error) return next(error)
      res.redirect(sloUrl)
    })
  //}
})

// Here is where the Identity Provider sends the user back. Included
// in the response are "attributes" with data about the user. The
// attributes returned from Samltest.id are detailed at the end of this
// page: https://samltest.id/download/
// HOWEVER, PLEASE NOTE that while these are relatively standard,
// it is possible and common for other Identity Providers to have
// totally different attribute names.
// Also note that passport-saml does not have a mechanism for the
// "friendly" attribute name which is obnoxious
// ALSO NOTE, this is configured up in the SAML Strategy. You can change
// the URL to fit your app, but you have to change it here and in the
// SAML Strategy configuration.
app.use('/auth/saml/sso',

  // The incoming SAML data is urlencoded and needs to be decoded
  bodyParser.urlencoded({ extended: false }),

  // Pass the incoming SAML data to passport for processing
  passport.authenticate('saml', {
    failureRedirect: '/login',
    failureFlash: true
  }),

  // YOUR CODE HERE... at this point, the user has been authenticated.
  function(req, res) {
    res.json(req.user)
  }
)

app.use('/auth/saml/slo',
  function(req, res, next) {
    req.logout(function(err) {
      if (err) { return next(err) }
      res.send('You are now logged out. Best practice is to 303 redirect away from this.')
    })
  }
)

// Endpoint for generating Service Provider Metadata.
// NOTE, SAML metadata is to be considered PUBLIC. It is safe to access
// unauthenticated and you really do not want to restrict access in
// any way, you're just making life more diffuclt if you do.
// ALSO NOTE: since you're developing on http://localhost:3000
// this metadata will be WRONG. See README.md for how to fix (it's easy)
// All is well if you're hosting on a standard port.
app.get('/auth/saml/metadata', function (req, res) {
  // surprising but correct.
  // https://www.iana.org/assignments/media-types/application/samlmetadata+xml
  // Prevents rendering in the browser. application/xml would also be OK, but
  // would not force a download.
  res.header('content-type', 'application/samlmetadata+xml')
  res.send(samlStrategy.generateServiceProviderMetadata( spDecryptionCert, spSigningCert ))
})

// Show a "home page." The inspiration for this example was a sort of
// open-source auth0 replacement, something your client-only SPA can 
// interact with in order to securely authenticate and authorize a user
// with SAML. This, however, is an example of how you would render a
// server-side page behind authentication.
// Also, in the real world, use a template engine like `pug`. I did not
// because this is a minimal example and really not even for a server-
// side app.
app.get('/', function (req, res) {
  if(req.user) {

    // Build attribute list
    var attrs = "<dl>"
    for (let attr in req.user.attributes) {
      attrs += `
        <dt style="font-style: italic">${attr}</dt>
        <dd style="font-weight: bold; margin-bottom: 0.5em">
          ${req.user.attributes[attr]}
        </dd>`
    }
    attrs += "</dl>"

    // Pull the "first name" attribute from the attribute list
    var name = req.user.attributes['urn:oid:2.5.4.42']

    // For some reason, they are kind enought to make email easy to get
    var mail = req.user.mail

    // Print a beautiful web page for logged-in users
    res.send(`
      <h1>Hi there, ${name}! <a href="/logout">Logout</a></h1>
      <p>${mail} has been subscribed to our hourly mailing list.</p>
      <p>Here is your personal data.</p>
      ${attrs}
    `)
  } else {
    // Print a beautiful web page for guest users
    res.send('<p>You are not <a href="/login">logged in</a>.</p>.')
  }
})

// Fire up the server
const port = process.env.PORT
console.log(`Listening on port ${port}`)
app.listen(port)
