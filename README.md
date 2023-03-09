ExpressJS Passport-SAML Example - The Right Way
===============================================

There are a million ways to do SAML wrong including the official example
(which is not so bad, just incomplete.) This is how to do it (mostly) right.

Features Represented in this example
------------------------------------

* SAML Single Sign-On
  * Initiated at /login
  * Completed at /auth/saml/sso
* SAML Metadata Generation
  * Available from /auth/saml/metadata

Terminology
-----------

<dl>
<dt>Identity Provider (IdP)</dt>
<dd>the system you log into which provides identities to service providers</dd>
<dt>Service Provider (SP)</dt>
<dd>the program that wants to authenticate with a central authority (like this
one!)</dd>
<dt>Metadata</dt>
<dd>Publicly accessible XML files containing cryptographic public keys and
HTTP endpoints and other SAML-specific configuration</dd>
<dt>Attribute</dt>
<dd>A piece of information about an identity, included in the response from IdP</dd>
<dt>Claim</dt>
<dd>An OpenID and ADFS term that does not exist in SAML. Regardless, some
use it interchangeably with "Attribute"</dd>
<dt>Integration</dt>
<dd>Exchange of metadata between the IdP and SP that sets up the trust
relationship and allows authentication to occur</dd>
</dl>

Setup
-----

1. Install node modules per usual

   ``` bash
   npm install
   ```

2. Generate a self-signed keypair for Service Provider Decryption

   ``` bash
   openssl req -x509 -newkey rsa:2048 \
     -keyout sp-decryption-key.pem \
     -out sp-decryption-cert.pem \
     -sha256 -days 3650 -nodes
   ```

3. Generate a self-signed keypair for Service Provider Signing

   ``` bash
   openssl req -x509 -newkey rsa:2048 \
     -keyout sp-signing-key.pem \
     -out sp-signing-cert.pem \
     -sha256 -days 3650 -nodes
   ```

4. Go to the [SAMLtest.id metadata page](https://samltest.id/download/).
   Under the heading *SAMLtest's IdP*, copy and paste the Signing Certificate
   (big block of gibberish starting with "MIID"). Put it in a file in this
   directory called `idp-cert.pem`. It is possible that they will change
   this certificate so I'm not including it in the repository, although
   that won't happen very often.

5. Run the server

   ``` bash
   node index.js
   ```

6. Download your SP Metadata

   ``` bash
   curl http://localhost:3000/auth/saml/metadata > metadata.xml
   ```

7. Edit metadata.xml and at the bottom of the file, modify the
   `AssertionConsumerService` tag to add the port number to your ACS URL:

   ``` xml
   <AssertionConsumerService
     Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
     Location="http://localhost:3000/login/callback"
     index="1" />
   ```

   This is due to a limitation in the metadata generator of passport-saml.
   If you were serving the application on a standart port like 80 or 443,
   you could skip this step entirely. Also note, DO NOT ADD THE PORT
   ANYWHERE ELSE like up in the entityID area, or you're gonna have a bad
   time.

8. [Upload your SP Metadata to SAMLtest.id](https://samltest.id/upload.php)

9. Go to http://localhost:3000/ in your browser and try logging in!

Understanding SAML
------------------

A full description of SAML is beyond the scope of this document.
Please read Shibboleth's description of
[How it All Fits Together](https://shibboleth.atlassian.net/wiki/spaces/CONCEPT/pages/928645290/FlowsAndConfig).
There are other guides online with pretty flowcharts from commercial
vendors that I do not wish to support.

Incoherent Ramblings on SAML trust
----------------------------------

These are X.509 certificates, exactly like what you would use for TLS on
a website. X.509 certificates come with the capability of outsourcing
trust by purchasing a certificate from a central signing authority.
**This functionality IS NOT USED by the SAML protocol, and you should not
trust a service provider or identity provider that claims to necessitate
certificate chain trust.** Trust in SAML is provided by the certificate
exchange between the Service Provider and the Identity Provider, and **not**
by any central signing authority. **As such, it is strongly recommended to
use self-signed certificates for SAML integration, and NOT certificates
purchased from a vendor.** With that said, chain trust is essential to the
trust model of TLS. So, **your SAML certificate MUST ALWAYS be a separate
keypair from your TLS certificate.** They are totally different things and
should not be used interchangeably, although they could be and many indeed
do this, to their own peril.

As a side note, **certificate expiration is also not important in the SAML
standard.** With that said, many will enforce it due to library constraints,
and security best practice recommends frequent rotation of cryptographic
credentials. We set the expiration to 10 years below. A production application
will need to give serious consideration to key rotation and management.
Automatic metadata generation and signing trust is essential to maintaining
a strong SAML integration.

 > tl;dr: Use a self-signed keypair for SAML signing. Then use a separate
 > self-signed keypair for SAML cryptography. Then use a totally separate
 > keypair signed by a [trustworthy central authority](https://letsencrypt.org)
 > for the TLS frontend to your application.

Opportunities for Improvement
-----------------------------

I'm still doing SAML very wrong here. The above instructions don't create a
Service Provider that can dynamically import an Identity Provider's metadata.
Even worse, it limits the IdP to one signing certificate, which is
irresponsible and inexcusable. I WILL update this, but I wanted to get these
instructions out to help someone and am working on this on my vacation day
and just don't have time right now.

The correct way is to use something like
[passport-saml-metadata](https://www.npmjs.com/package/passport-saml-metadata)
to load and process the multiple certs out of the IdP MD. Unfortunately
that particular library comes with unnecessary dependencies and since it
is geared towards Active Directory Federated Services (an offshoot from SAML),
it does not do vanilla SAML correctly and uses ADFS-specific language rather
than SAML-general language. I'd like to submit some improvements to this
library and then update this example.

Also.. like a test suite or something?