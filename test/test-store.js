const {expect} = require('chai').use(require('chai-as-promised'));
const Store = require('../src/store.js');
const sample_data = require('fs').readFileSync('test/sample.json');
const {readFile, unlink} = require('fs').promises;

async function testPost(store, posts) {

    let expectedChangeCount = 0;
    let realChangeCount = 0;

    for (let test of posts) {
        let changeIndex = 0;
        expectedChangeCount += test.changes.length;

        for (let change of await store.post(test.path, test.data)) {
            expect(change).to.eql(test.changes[changeIndex++]);
            realChangeCount++;
        }
    }

    expect(realChangeCount).to.equal(expectedChangeCount, 'real changes');
}

describe('Store', function (){
    describe('initialize', function() {
        it('should initialize with minimum parameters', async function() {
            let store = new Store();
            expect(await store._storePromise).eqls({});
        });

        it('should initialize with a store', async function() {
            const testPath = 'test_store.test';
            const data = {abc: '123'};
            const db = new Store({store: data, path: testPath});

            expect(await db._storePromise).equals(data);
            expect(readFile(testPath)).to.eventually.have.property('code', 'ENOENT');
        });

        it('should initialize with a store from a path', async function() {
            const db = new Store({path: 'test/sample.json'});
            let expectedStore = JSON.parse(sample_data);

            expect(db._storePromise).to.eventually.eql(expectedStore);
        })
    });

    describe('_getKeyIndex', function(){
        it('should return get a simple key', function() {
            let [key, index] = Store._getKeyIndex('abc');
            expect(key).to.equal('abc');
            expect(index).to.be.undefined;
        });

        it('should get a key and array index', function() {
            let [key, index] = Store._getKeyIndex('abc[5]');
            expect(key).to.equal('abc');
            expect(index).to.equal(5);
        });
    });

    describe('_getBase', function() {
        it('should retrieve a base given a valid path', function() {
            let sample = JSON.parse(sample_data);

            let tests = {
                'simple': [sample, 'simple', '/'],
                '//simple//': [sample, 'simple', '/'],
                'obj/a1': [sample.obj, 'a1', '/obj'],
                'obj///a1': [sample.obj, 'a1', '/obj'],
                'obj/a2/b2': [sample.obj.a2, 'b2', '/obj/a2'],
                'arr[0]': [sample.arr, 0, '/arr'],
                '/arr': [sample, 'arr', '/'],
                'arr[2]/d3[2]/f2': [sample.arr[2].d3[2], 'f2', '/arr[2]/d3[2]'],
                'arr[2]/d3': [sample.arr[2], 'd3', '/arr[2]'],
                'arr[2]/d3[2]': [sample.arr[2].d3, 2, '/arr[2]/d3'],
                '': [sample, undefined, '/']
            };

            for(var i in tests) {
                expect(Store._getBase(i, sample)).to.eql(tests[i], `Base search failed for path "${i}"`);
            }

            // expect(Store._getBase('simple/newObj/newArr[2]/x'))
        });
    });

    describe('_apply', function() {
        let sample = JSON.parse(sample_data)
        it('should apply changes to an object', function() {
            let results = Store._apply(sample, {
                obj: {
                    a2: {
                        b1: "r",
                        b3: 'test'
                    },
                },
                arr: [
                    "h",
                    "j",
                    {
                        d1: { s1: "t" },
                        d4: 'abc'
                    }
                ]
            });

            let expectedChanges = [
                {
                    type: 'changed',
                    path: '/obj/a2/b1',
                    oldValue: "c",
                    newValue: "r"
                },
                {
                    type: 'missing',
                    path: '/obj/a2/b3',
                    oldValue: undefined,
                    newValue: 'test'
                },
                {
                    type: 'changed',
                    path: '/arr[1]',
                    oldValue: "k",
                    newValue: 'j'
                },
                {
                    type: 'changed',
                    path: '/arr[2]/d1',
                    oldValue: "f",
                    newValue: { s1: "t"}
                },
                {
                    type: 'missing',
                    path: '/arr[2]/d4',
                    oldValue: undefined,
                    newValue: 'abc'
                },
            ]

            let changes = 0;

            for (let res of results) {
                expect(res).to.eql(expectedChanges[changes]);
                changes++;
            }

            expect(changes).to.equal(expectedChanges.length)
        });
    });
    
    describe('posting', function() {
        it('should post data to the store.', async function() {
            let posts = [
                { path: '/result', data: 'abc', changes: [
                    { type: 'missing', path: '/result', oldValue: undefined, newValue: 'abc' }]},
                { path: '/noobj', data: { hello: 'world' }, changes: [
                    {type: 'missing', path: '/noobj', oldValue: undefined, newValue: { hello: 'world' }}]},
                { path: '/obj/result', data: '123', changes: [
                    {type: 'missing', path: '/obj/result', oldValue: undefined, newValue: '123'}]},
                { path: '/nestedObj/obj/result', data: 'abc123', changes: [
                    {type: 'missing', path: '/nestedObj/obj/result', oldValue: undefined, newValue: 'abc123'}]},
                { path: '/obj', data: { result: 456, data: 'hey' }, changes: [
                    {type: 'changed', path: '/obj/result', oldValue: '123', newValue: 456},
                    {type: 'missing', path: '/obj/data', oldValue: undefined, newValue: 'hey'}]},
                { path: '/obj/arr[5]/test', data: 'omg', changes:[
                    {type: 'missing', path: '/obj/arr[5]/test', oldValue: undefined, newValue: 'omg'}
                ]},
                { path: '/obj/arr[2]/test', data: 'omg2', changes:[
                    {type: 'missing', path: '/obj/arr[2]/test', oldValue: undefined, newValue: 'omg2'}
                ]},
                { path: '/obj/arr[1]', data: 'omg3', changes:[
                    {type: 'missing', path: '/obj/arr[1]', oldValue: undefined, newValue: 'omg3'}
                ]}
            ];

            let expectedResult = {
                result: 'abc',
                noobj: { hello: 'world' },
                obj: { result: 456, data: 'hey', arr: [, 
                    'omg3',
                    { test: 'omg2'},,,
                    { test: 'omg'}
                ]},
                nestedObj: { obj: { result: 'abc123' }}
            };

            const store = new Store();
            await testPost(store, posts, expectedResult);
            expect(await store._storePromise).to.eql(expectedResult);
        });

        it('should perform an immediate post', async function() {
            let store = new Store();
            let changes = await store.postNow('/result', 'stuff');
            expect(changes).to.eql([{type: 'missing', path:'/result', oldValue: undefined, newValue: 'stuff'}]);
            // expect(readFile(testPath)).to.eventually.have.property('code', 'ENOENT');
        })

        it('should perform an immediate post and save', async function() {
            let path = 'test/test.json';
            let store = new Store({path: path});
            let changes = await store.postNow(true, '/result', { hello: 'world' });
            expect(changes).to.eql([{type: 'missing', path:'/result', oldValue: undefined, newValue: { hello: 'world'}}]);
            expect(readFile(path)).to.eventually.eql(JSON.stringify(await store._storePromise));
            expect(unlink(path)).to.be.fulfilled;
            // expect(readFile(testPath)).to.eventually.have.property('code', 'ENOENT');
        })
    });
});