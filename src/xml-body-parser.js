

const { Parser, Builder } = require('xml2js');
const xmlContentType = 'application/xml';


function sendAsXml(res, data) {
    let xml = new Builder().buildObject(data);
    res.set('Content-Type', xmlContentType).send(xml);
}

function parseXmlBody(xml, options) {
    if(!xml) return Promise.resolve();
    return new Parser(options).parseStringPromise(xml);
}



module.exports = function({
    types=['application/xml'],
    alwaysAttemptParse=false,
    failOnParseError=false,
    parseOptions= undefined
} = {}) {
    return function(req, res, next) {
        res.sendXml = (data) => sendAsXml(res, data);
        
        var type = req.headers['content-type']?.split(';')[0];
        if(alwaysAttemptParse || types.includes(type)) {
            return parseXmlBody(req.body.data, parseOptions).then(xml => {
                req.isXml = true;
                req.body.data = xml;
                next();
                return true;
            }, err => {
                req.isXml = false;
                if (failOnParseError) next(err);
                next()
                return false;
            })
        } else {
            req.isXml = false;
            next();
        }
    }
}

module.exports.parseXml = parseXmlBody;
module.exports.sendXml = sendAsXml;