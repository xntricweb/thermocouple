const { request } = require("http");

const host = 'localhost';
const port = 80;

const sn = '3717N010092';
const domain = 'status';

makeRequest();

async function makeRequest() {
    let body = await consumer(process.stdin);
    body = `data=${encodeURIComponent(body)}`;

    const options = {
        host: host,
        port: port,
        path: `/systems/${sn}/${domain}`,
        method: 'post',
        headers: {
            'Content-Length': Buffer.byteLength(body, 'utf8'),
            'Content-Type': 'application/x-www-form-urlencoded',
        }
    }

    const req = request(options, async (res) => {
        console.info(`STATUS: ${res.statusCode}`);
        var body = await consumer(res);

        console.log(body);
    });
    req.write(body);
    req.end();
}



function consumer(stream) {
    return new Promise((res, rej) => {
        var data = '';

        stream.on('data', (chunk) => {
            data += chunk.toString();
        });
    
        stream.on('end', () => res(data));
        stream.on('error', (err) => rej(err));
    });
}