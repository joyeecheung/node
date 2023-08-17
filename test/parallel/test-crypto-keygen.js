'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const {
  constants,
  createPrivateKey,
  generateKeyPair,
  generateKeyPairSync,
  getCurves,
} = require('crypto');
const {
  assertApproximateSize,
  testEncryptDecrypt,
  testSignVerify,
  pkcs1PubExp,
  pkcs1PrivExp,
  pkcs1EncExp,
  spkiExp,
  pkcs8Exp,
  pkcs8EncExp,
  sec1Exp,
  sec1EncExp,
} = require('../common/crypto');
const { promisify } = require('util');

// To make the test faster, we will only test sync key generation once and
// with a relatively small key.
{
  const ret = generateKeyPairSync('rsa', {
    publicExponent: 3,
    modulusLength: 512,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  assert.strictEqual(Object.keys(ret).length, 2);
  const { publicKey, privateKey } = ret;

  assert.strictEqual(typeof publicKey, 'string');
  assert.match(publicKey, pkcs1PubExp);
  assertApproximateSize(publicKey, 162);
  assert.strictEqual(typeof privateKey, 'string');
  assert.match(privateKey, pkcs8Exp);
  assertApproximateSize(privateKey, 512);

  testEncryptDecrypt(publicKey, privateKey);
  testSignVerify(publicKey, privateKey);
}

// Test sync key generation with key objects with a non-standard
// publicExponent
{
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    publicExponent: 3,
    modulusLength: 512
  });

  assert.strictEqual(typeof publicKey, 'object');
  assert.strictEqual(publicKey.type, 'public');
  assert.strictEqual(publicKey.asymmetricKeyType, 'rsa');
  assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {
    modulusLength: 512,
    publicExponent: 3n
  });

  assert.strictEqual(typeof privateKey, 'object');
  assert.strictEqual(privateKey.type, 'private');
  assert.strictEqual(privateKey.asymmetricKeyType, 'rsa');
  assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {
    modulusLength: 512,
    publicExponent: 3n
  });
}

// Test sync key generation with key objects.
{
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 512
  });

  assert.strictEqual(typeof publicKey, 'object');
  assert.strictEqual(publicKey.type, 'public');
  assert.strictEqual(publicKey.asymmetricKeyType, 'rsa');
  assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {
    modulusLength: 512,
    publicExponent: 65537n
  });

  assert.strictEqual(typeof privateKey, 'object');
  assert.strictEqual(privateKey.type, 'private');
  assert.strictEqual(privateKey.asymmetricKeyType, 'rsa');
  assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {
    modulusLength: 512,
    publicExponent: 65537n
  });
}

// Test async RSA key generation.
{
  generateKeyPair('rsa', {
    publicExponent: 0x10001,
    modulusLength: 512,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  }, common.mustSucceed((publicKeyDER, privateKey) => {
    assert(Buffer.isBuffer(publicKeyDER));
    assertApproximateSize(publicKeyDER, 74);

    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, pkcs1PrivExp);
    assertApproximateSize(privateKey, 512);

    const publicKey = {
      key: publicKeyDER,
      type: 'pkcs1',
      format: 'der',
    };
    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  }));
}

// Test async RSA key generation with an encrypted private key.
{
  generateKeyPair('rsa', {
    publicExponent: 0x10001,
    modulusLength: 512,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'secret'
    }
  }, common.mustSucceed((publicKeyDER, privateKey) => {
    assert(Buffer.isBuffer(publicKeyDER));
    assertApproximateSize(publicKeyDER, 74);

    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, pkcs1EncExp('AES-256-CBC'));

    // Since the private key is encrypted, signing shouldn't work anymore.
    const publicKey = {
      key: publicKeyDER,
      type: 'pkcs1',
      format: 'der',
    };
    const expectedError = common.hasOpenSSL3 ? {
      name: 'Error',
      message: 'error:07880109:common libcrypto routines::interrupted or ' +
               'cancelled'
    } : {
      name: 'TypeError',
      code: 'ERR_MISSING_PASSPHRASE',
      message: 'Passphrase required for encrypted key'
    };
    assert.throws(() => testSignVerify(publicKey, privateKey), expectedError);

    const key = { key: privateKey, passphrase: 'secret' };
    testEncryptDecrypt(publicKey, key);
    testSignVerify(publicKey, key);
  }));
}

// Test async RSA key generation with an encrypted private key, but encoded as DER.
{
  generateKeyPair('rsa', {
    publicExponent: 0x10001,
    modulusLength: 512,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
      cipher: 'aes-256-cbc',
      passphrase: 'secret'
    }
  }, common.mustSucceed((publicKeyDER, privateKeyDER) => {
    assert(Buffer.isBuffer(publicKeyDER));
    assertApproximateSize(publicKeyDER, 74);

    assert(Buffer.isBuffer(privateKeyDER));

    // Since the private key is encrypted, signing shouldn't work anymore.
    const publicKey = {
      key: publicKeyDER,
      type: 'pkcs1',
      format: 'der',
    };
    assert.throws(() => {
      testSignVerify(publicKey, {
        key: privateKeyDER,
        format: 'der',
        type: 'pkcs8'
      });
    }, {
      name: 'TypeError',
      code: 'ERR_MISSING_PASSPHRASE',
      message: 'Passphrase required for encrypted key'
    });

    // Signing should work with the correct password.

    const privateKey = {
      key: privateKeyDER,
      format: 'der',
      type: 'pkcs8',
      passphrase: 'secret'
    };
    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  }));
}

// Test async RSA key generation with an encrypted private key, but encoded as DER.
{
  generateKeyPair('rsa', {
    publicExponent: 0x10001,
    modulusLength: 512,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der'
    }
  }, common.mustSucceed((publicKeyDER, privateKeyDER) => {
    assert(Buffer.isBuffer(publicKeyDER));
    assertApproximateSize(publicKeyDER, 74);

    assert(Buffer.isBuffer(privateKeyDER));

    const publicKey = {
      key: publicKeyDER,
      type: 'pkcs1',
      format: 'der',
    };
    const privateKey = {
      key: privateKeyDER,
      format: 'der',
      type: 'pkcs8',
      passphrase: 'secret'
    };
    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  }));
}

// Test RSA-PSS.
{
  generateKeyPair('rsa-pss', {
    modulusLength: 512,
    saltLength: 16,
    hashAlgorithm: 'sha256',
    mgf1HashAlgorithm: 'sha256'
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(publicKey.type, 'public');
    assert.strictEqual(publicKey.asymmetricKeyType, 'rsa-pss');
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    });

    assert.strictEqual(privateKey.type, 'private');
    assert.strictEqual(privateKey.asymmetricKeyType, 'rsa-pss');
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    });

    // Unlike RSA, RSA-PSS does not allow encryption.
    assert.throws(() => {
      testEncryptDecrypt(publicKey, privateKey);
    }, /operation not supported for this keytype/);

    // RSA-PSS also does not permit signing with PKCS1 padding.
    assert.throws(() => {
      testSignVerify({
        key: publicKey,
        padding: constants.RSA_PKCS1_PADDING
      }, {
        key: privateKey,
        padding: constants.RSA_PKCS1_PADDING
      });
    }, /illegal or unsupported padding mode/);

    // The padding should correctly default to RSA_PKCS1_PSS_PADDING now.
    testSignVerify(publicKey, privateKey);
  }));
}

// 'rsa-pss' should not add a RSASSA-PSS-params sequence by default.
// Regression test for: https://github.com/nodejs/node/issues/39936
{
  generateKeyPair('rsa-pss', {
    modulusLength: 512
  }, common.mustSucceed((publicKey, privateKey) => {
    const expectedKeyDetails = {
      modulusLength: 512,
      publicExponent: 65537n
    };
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, expectedKeyDetails);
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, expectedKeyDetails);

    // To allow backporting the fix to versions that do not support
    // asymmetricKeyDetails for RSA-PSS params, also verify that the exported
    // AlgorithmIdentifier member of the SubjectPublicKeyInfo has the expected
    // length of 11 bytes (as opposed to > 11 bytes if node added params).
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    assert.strictEqual(spki[3], 11, spki.toString('hex'));
  }));
}

// RFC 8017, 9.1.: "Assuming that the mask generation function is based on a
// hash function, it is RECOMMENDED that the hash function be the same as the
// one that is applied to the message."
{

  generateKeyPair('rsa-pss', {
    modulusLength: 512,
    hashAlgorithm: 'sha256',
    saltLength: 16
  }, common.mustSucceed((publicKey, privateKey) => {
    const expectedKeyDetails = {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    };
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, expectedKeyDetails);
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, expectedKeyDetails);
  }));
}

// RFC 8017, A.2.3.: "For a given hashAlgorithm, the default value of
// saltLength is the octet length of the hash value."
{
  generateKeyPair('rsa-pss', {
    modulusLength: 512,
    hashAlgorithm: 'sha512'
  }, common.mustSucceed((publicKey, privateKey) => {
    const expectedKeyDetails = {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha512',
      mgf1HashAlgorithm: 'sha512',
      saltLength: 64
    };
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, expectedKeyDetails);
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, expectedKeyDetails);
  }));

  // It is still possible to explicitly set saltLength to 0.
  generateKeyPair('rsa-pss', {
    modulusLength: 512,
    hashAlgorithm: 'sha512',
    saltLength: 0
  }, common.mustSucceed((publicKey, privateKey) => {
    const expectedKeyDetails = {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha512',
      mgf1HashAlgorithm: 'sha512',
      saltLength: 0
    };
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, expectedKeyDetails);
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, expectedKeyDetails);
  }));
}

// Test async DSA key generation.
{
  const privateKeyEncoding = {
    type: 'pkcs8',
    format: 'der'
  };

  generateKeyPair('dsa', {
    modulusLength: common.hasOpenSSL3 ? 2048 : 512,
    divisorLength: 256,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      cipher: 'aes-128-cbc',
      passphrase: 'secret',
      ...privateKeyEncoding
    }
  }, common.mustSucceed((publicKey, privateKeyDER) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    // The private key is DER-encoded.
    assert(Buffer.isBuffer(privateKeyDER));

    assertApproximateSize(publicKey, common.hasOpenSSL3 ? 1194 : 440);
    assertApproximateSize(privateKeyDER, common.hasOpenSSL3 ? 721 : 336);

    // Since the private key is encrypted, signing shouldn't work anymore.
    assert.throws(() => {
      return testSignVerify(publicKey, {
        key: privateKeyDER,
        ...privateKeyEncoding
      });
    }, {
      name: 'TypeError',
      code: 'ERR_MISSING_PASSPHRASE',
      message: 'Passphrase required for encrypted key'
    });

    // Signing should work with the correct password.
    testSignVerify(publicKey, {
      key: privateKeyDER,
      ...privateKeyEncoding,
      passphrase: 'secret'
    });
  }));
}

// Test async DSA key object generation.
{
  generateKeyPair('dsa', {
    modulusLength: common.hasOpenSSL3 ? 2048 : 512,
    divisorLength: 256
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(publicKey.type, 'public');
    assert.strictEqual(publicKey.asymmetricKeyType, 'dsa');
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {
      modulusLength: common.hasOpenSSL3 ? 2048 : 512,
      divisorLength: 256
    });

    assert.strictEqual(privateKey.type, 'private');
    assert.strictEqual(privateKey.asymmetricKeyType, 'dsa');
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {
      modulusLength: common.hasOpenSSL3 ? 2048 : 512,
      divisorLength: 256
    });
  }));
}

// Test async named elliptic curve key generation, e.g. for ECDSA,
// with a SEC1 private key.
{
  generateKeyPair('ec', {
    namedCurve: 'prime256v1',
    paramEncoding: 'named',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'sec1',
      format: 'pem'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, sec1Exp);

    testSignVerify(publicKey, privateKey);
  }));
}

// Test async elliptic curve key generation, e.g. for ECDSA, with a SEC1
// private key with paramEncoding explicit.
{
  generateKeyPair('ec', {
    namedCurve: 'prime256v1',
    paramEncoding: 'explicit',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'sec1',
      format: 'pem'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, sec1Exp);

    testSignVerify(publicKey, privateKey);
  }));
}

{
  // Test async named elliptic curve key generation with an encrypted
  // private key.
  generateKeyPair('ec', {
    namedCurve: 'prime256v1',
    paramEncoding: 'named',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'sec1',
      format: 'pem',
      cipher: 'aes-128-cbc',
      passphrase: 'secret'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, sec1EncExp('AES-128-CBC'));

    // Since the private key is encrypted, signing shouldn't work anymore.
    assert.throws(() => testSignVerify(publicKey, privateKey),
                  common.hasOpenSSL3 ? {
                    message: 'error:07880109:common libcrypto ' +
                             'routines::interrupted or cancelled'
                  } : {
                    name: 'TypeError',
                    code: 'ERR_MISSING_PASSPHRASE',
                    message: 'Passphrase required for encrypted key'
                  });

    testSignVerify(publicKey, { key: privateKey, passphrase: 'secret' });
  }));
}

{
  // Test async explicit elliptic curve key generation with an encrypted
  // private key.
  generateKeyPair('ec', {
    namedCurve: 'prime256v1',
    paramEncoding: 'explicit',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'sec1',
      format: 'pem',
      cipher: 'aes-128-cbc',
      passphrase: 'secret'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, sec1EncExp('AES-128-CBC'));

    // Since the private key is encrypted, signing shouldn't work anymore.
    assert.throws(() => testSignVerify(publicKey, privateKey),
                  common.hasOpenSSL3 ? {
                    message: 'error:07880109:common libcrypto ' +
                             'routines::interrupted or cancelled'
                  } : {
                    name: 'TypeError',
                    code: 'ERR_MISSING_PASSPHRASE',
                    message: 'Passphrase required for encrypted key'
                  });

    testSignVerify(publicKey, { key: privateKey, passphrase: 'secret' });
  }));
}

// Test async elliptic curve key generation, e.g. for ECDSA, with an encrypted
// private key.
{
  generateKeyPair('ec', {
    namedCurve: 'P-256',
    paramEncoding: 'named',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-128-cbc',
      passphrase: 'top secret'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, pkcs8EncExp);

    // Since the private key is encrypted, signing shouldn't work anymore.
    assert.throws(() => testSignVerify(publicKey, privateKey),
                  common.hasOpenSSL3 ? {
                    message: 'error:07880109:common libcrypto ' +
                             'routines::interrupted or cancelled'
                  } : {
                    name: 'TypeError',
                    code: 'ERR_MISSING_PASSPHRASE',
                    message: 'Passphrase required for encrypted key'
                  });

    testSignVerify(publicKey, {
      key: privateKey,
      passphrase: 'top secret'
    });
  }));
}

// Test async elliptic curve key generation, e.g. for ECDSA, with an encrypted
// private key with paramEncoding explicit.
{
  generateKeyPair('ec', {
    namedCurve: 'P-256',
    paramEncoding: 'explicit',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-128-cbc',
      passphrase: 'top secret'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, spkiExp);
    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, pkcs8EncExp);

    // Since the private key is encrypted, signing shouldn't work anymore.
    assert.throws(() => testSignVerify(publicKey, privateKey),
                  common.hasOpenSSL3 ? {
                    message: 'error:07880109:common libcrypto ' +
                             'routines::interrupted or cancelled'
                  } : {
                    name: 'TypeError',
                    code: 'ERR_MISSING_PASSPHRASE',
                    message: 'Passphrase required for encrypted key'
                  });

    testSignVerify(publicKey, {
      key: privateKey,
      passphrase: 'top secret'
    });
  }));
}

// Test async elliptic curve key generation with 'jwk' encoding
{
  [
    ['ec', ['P-384', 'P-256', 'P-521', 'secp256k1']],
    ['rsa'],
    ['ed25519'],
    ['ed448'],
    ['x25519'],
    ['x448'],
  ].forEach((types) => {
    const [type, options] = types;
    switch (type) {
      case 'ec': {
        return options.forEach((curve) => {
          generateKeyPair(type, {
            namedCurve: curve,
            publicKeyEncoding: {
              format: 'jwk'
            },
            privateKeyEncoding: {
              format: 'jwk'
            }
          }, common.mustSucceed((publicKey, privateKey) => {
            assert.strictEqual(typeof publicKey, 'object');
            assert.strictEqual(typeof privateKey, 'object');
            assert.strictEqual(publicKey.x, privateKey.x);
            assert.strictEqual(publicKey.y, privateKey.y);
            assert(!publicKey.d);
            assert(privateKey.d);
            assert.strictEqual(publicKey.kty, 'EC');
            assert.strictEqual(publicKey.kty, privateKey.kty);
            assert.strictEqual(publicKey.crv, curve);
            assert.strictEqual(publicKey.crv, privateKey.crv);
          }));
        });
      }
      case 'rsa': {
        return generateKeyPair(type, {
          modulusLength: 4096,
          publicKeyEncoding: {
            format: 'jwk'
          },
          privateKeyEncoding: {
            format: 'jwk'
          }
        }, common.mustSucceed((publicKey, privateKey) => {
          assert.strictEqual(typeof publicKey, 'object');
          assert.strictEqual(typeof privateKey, 'object');
          assert.strictEqual(publicKey.kty, 'RSA');
          assert.strictEqual(publicKey.kty, privateKey.kty);
          assert.strictEqual(typeof publicKey.n, 'string');
          assert.strictEqual(publicKey.n, privateKey.n);
          assert.strictEqual(typeof publicKey.e, 'string');
          assert.strictEqual(publicKey.e, privateKey.e);
          assert.strictEqual(typeof privateKey.d, 'string');
          assert.strictEqual(typeof privateKey.p, 'string');
          assert.strictEqual(typeof privateKey.q, 'string');
          assert.strictEqual(typeof privateKey.dp, 'string');
          assert.strictEqual(typeof privateKey.dq, 'string');
          assert.strictEqual(typeof privateKey.qi, 'string');
        }));
      }
      case 'ed25519':
      case 'ed448':
      case 'x25519':
      case 'x448': {
        generateKeyPair(type, {
          publicKeyEncoding: {
            format: 'jwk'
          },
          privateKeyEncoding: {
            format: 'jwk'
          }
        }, common.mustSucceed((publicKey, privateKey) => {
          assert.strictEqual(typeof publicKey, 'object');
          assert.strictEqual(typeof privateKey, 'object');
          assert.strictEqual(publicKey.x, privateKey.x);
          assert(!publicKey.d);
          assert(privateKey.d);
          assert.strictEqual(publicKey.kty, 'OKP');
          assert.strictEqual(publicKey.kty, privateKey.kty);
          const expectedCrv = `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
          assert.strictEqual(publicKey.crv, expectedCrv);
          assert.strictEqual(publicKey.crv, privateKey.crv);
        }));
      }
    }
  });
}

// Test the util.promisified API with async RSA key generation.
{
  promisify(generateKeyPair)('rsa', {
    publicExponent: 0x10001,
    modulusLength: 512,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  }).then(common.mustCall((keys) => {
    const { publicKey, privateKey } = keys;
    assert.strictEqual(typeof publicKey, 'string');
    assert.match(publicKey, pkcs1PubExp);
    assertApproximateSize(publicKey, 180);

    assert.strictEqual(typeof privateKey, 'string');
    assert.match(privateKey, pkcs1PrivExp);
    assertApproximateSize(privateKey, 512);

    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  }));
}

// Tests key objects are returned when key encodings are not specified.
{
  // If no publicKeyEncoding is specified, a key object should be returned.
  generateKeyPair('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(typeof publicKey, 'object');
    assert.strictEqual(publicKey.type, 'public');
    assert.strictEqual(publicKey.asymmetricKeyType, 'rsa');

    // The private key should still be a string.
    assert.strictEqual(typeof privateKey, 'string');

    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  }));

  // If no privateKeyEncoding is specified, a key object should be returned.
  generateKeyPair('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    // The public key should still be a string.
    assert.strictEqual(typeof publicKey, 'string');

    assert.strictEqual(typeof privateKey, 'object');
    assert.strictEqual(privateKey.type, 'private');
    assert.strictEqual(privateKey.asymmetricKeyType, 'rsa');

    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  }));
}

// Test EdDSA key generation.
{
  if (!/^1\.1\.0/.test(process.versions.openssl)) {
    ['ed25519', 'ed448', 'x25519', 'x448'].forEach((keyType) => {
      generateKeyPair(keyType, common.mustSucceed((publicKey, privateKey) => {
        assert.strictEqual(publicKey.type, 'public');
        assert.strictEqual(publicKey.asymmetricKeyType, keyType);
        assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {});

        assert.strictEqual(privateKey.type, 'private');
        assert.strictEqual(privateKey.asymmetricKeyType, keyType);
        assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {});
      }));
    });
  }
}

// Test classic Diffie-Hellman key generation.
{
  generateKeyPair('dh', {
    primeLength: 1024
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(publicKey.type, 'public');
    assert.strictEqual(publicKey.asymmetricKeyType, 'dh');

    assert.strictEqual(privateKey.type, 'private');
    assert.strictEqual(privateKey.asymmetricKeyType, 'dh');
  }));
}

// Passing an empty passphrase string should not cause OpenSSL's default
// passphrase prompt in the terminal.
// See https://github.com/nodejs/node/issues/35898.
for (const type of ['pkcs1', 'pkcs8']) {
  generateKeyPair('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: {
      type,
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: ''
    }
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(publicKey.type, 'public');

    for (const passphrase of ['', Buffer.alloc(0)]) {
      const privateKeyObject = createPrivateKey({
        passphrase,
        key: privateKey
      });
      assert.strictEqual(privateKeyObject.asymmetricKeyType, 'rsa');
    }

    // Encrypting with an empty passphrase is not the same as not encrypting
    // the key, and not specifying a passphrase should fail when decoding it.
    assert.throws(() => {
      return testSignVerify(publicKey, privateKey);
    }, common.hasOpenSSL3 ? {
      name: 'Error',
      code: 'ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED',
      message: 'error:07880109:common libcrypto routines::interrupted or cancelled'
    } : {
      name: 'TypeError',
      code: 'ERR_MISSING_PASSPHRASE',
      message: 'Passphrase required for encrypted key'
    });
  }));
}

// Passing an empty passphrase string should not throw ERR_OSSL_CRYPTO_MALLOC_FAILURE even on OpenSSL 3.
// Regression test for https://github.com/nodejs/node/issues/41428.
generateKeyPair('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: ''
  }
}, common.mustSucceed((publicKey, privateKey) => {
  assert.strictEqual(typeof publicKey, 'string');
  assert.strictEqual(typeof privateKey, 'string');
}));

// This test creates EC key pairs on curves without associated OIDs.
// Specifying a key encoding should not crash.
{

  if (process.versions.openssl >= '1.1.1i') {
    for (const namedCurve of ['Oakley-EC2N-3', 'Oakley-EC2N-4']) {
      if (!getCurves().includes(namedCurve))
        continue;

      const expectedErrorCode =
        common.hasOpenSSL3 ? 'ERR_OSSL_MISSING_OID' : 'ERR_OSSL_EC_MISSING_OID';
      const params = {
        namedCurve,
        publicKeyEncoding: {
          format: 'der',
          type: 'spki'
        }
      };

      assert.throws(() => {
        generateKeyPairSync('ec', params);
      }, {
        code: expectedErrorCode
      });

      generateKeyPair('ec', params, common.mustCall((err) => {
        assert.strictEqual(err.code, expectedErrorCode);
      }));
    }
  }
}

// This test makes sure deprecated and new options may be used
// simultaneously so long as they're identical values.
{

  generateKeyPair('rsa-pss', {
    modulusLength: 512,
    saltLength: 16,
    hash: 'sha256',
    hashAlgorithm: 'sha256',
    mgf1Hash: 'sha256',
    mgf1HashAlgorithm: 'sha256'
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(publicKey.type, 'public');
    assert.strictEqual(publicKey.asymmetricKeyType, 'rsa-pss');
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    });

    assert.strictEqual(privateKey.type, 'private');
    assert.strictEqual(privateKey.asymmetricKeyType, 'rsa-pss');
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    });
  }));
}

// This tests check that generateKeyPair returns correct bit length in
// KeyObject's asymmetricKeyDetails.
// https://github.com/nodejs/node/issues/46102#issuecomment-1372153541
{

  generateKeyPair('rsa', {
    modulusLength: 513,
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(privateKey.asymmetricKeyDetails.modulusLength, 513);
    assert.strictEqual(publicKey.asymmetricKeyDetails.modulusLength, 513);
  }));

  generateKeyPair('rsa-pss', {
    modulusLength: 513,
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(privateKey.asymmetricKeyDetails.modulusLength, 513);
    assert.strictEqual(publicKey.asymmetricKeyDetails.modulusLength, 513);
  }));

  if (common.hasOpenSSL3) {
    generateKeyPair('dsa', {
      modulusLength: 2049,
      divisorLength: 256,
    }, common.mustSucceed((publicKey, privateKey) => {
      assert.strictEqual(privateKey.asymmetricKeyDetails.modulusLength, 2049);
      assert.strictEqual(publicKey.asymmetricKeyDetails.modulusLength, 2049);
    }));
  }
}
