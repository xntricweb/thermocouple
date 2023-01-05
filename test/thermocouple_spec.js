

describe('thermocouple', function() {

    it('should initialize', function() {
        const config = makeConfig();
        const thermocouple = new Thermocouple(config);

        expect(thermocouple.status).to.equal('idle');
    });

    
})