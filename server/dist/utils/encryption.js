"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.processConnectionSensitiveData = processConnectionSensitiveData;
// Bridge stub for compiled dist to reach source JS implementation (typed)
const crypto_js_1 = __importDefault(require("crypto-js"));
const getSecretKey = () => process.env.ENCRYPTION_KEY || 'default-secret-key';
function encrypt(text) {
    if (!text)
        return '';
    return crypto_js_1.default.AES.encrypt(text, getSecretKey()).toString();
}
function decrypt(cipher) {
    if (!cipher)
        return '';
    try {
        const bytes = crypto_js_1.default.AES.decrypt(cipher, getSecretKey());
        return bytes.toString(crypto_js_1.default.enc.Utf8);
    }
    catch {
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
const api = {
    encrypt,
    decrypt,
    processConnectionSensitiveData,
    decryptPassword: decrypt,
    decryptPrivateKey: decrypt
};
module.exports = api;
exports.default = api;
