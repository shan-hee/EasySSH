"use strict";
// Bridge stub for compiled dist to reach source JS implementation
// @ts-nocheck
const crypto = require('crypto-js');
const getSecretKey = () => process.env.ENCRYPTION_KEY || 'default-secret-key';
function encrypt(text) {
    if (!text)
        return '';
    return crypto.AES.encrypt(text, getSecretKey()).toString();
}
function decrypt(cipher) {
    if (!cipher)
        return '';
    try {
        const bytes = crypto.AES.decrypt(cipher, getSecretKey());
        return bytes.toString(crypto.enc.Utf8);
    }
    catch (e) {
        return '';
    }
}
function processConnectionSensitiveData(connection, toEncrypt = true) {
    const c = { ...connection };
    if (toEncrypt) {
        if (c.password)
            c.password = encrypt(c.password);
        if (c.passphrase)
            c.passphrase = encrypt(c.passphrase);
        if (c.privateKey)
            c.privateKey = encrypt(c.privateKey);
    }
    else {
        if (c.password)
            c.password = decrypt(c.password);
        if (c.passphrase)
            c.passphrase = decrypt(c.passphrase);
        if (c.privateKey)
            c.privateKey = decrypt(c.privateKey);
    }
    return c;
}
module.exports = {
    encrypt,
    decrypt,
    processConnectionSensitiveData,
    decryptPassword: decrypt,
    decryptPrivateKey: decrypt
};
