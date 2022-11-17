const {expect} = require('chai').use(require('chai-as-promised'));
const sample_data = require('fs').readFileSync('test/sample.json');
const {readFile, unlink} = require('fs').promises;
const Translator = require('../src/translator.js');

describe('Translator', function() {
    describe('register', function() {
        it ('should register translations', function() {
            let tranlate = new Translator();
            translate.register
        })
    })
})