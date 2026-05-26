const http = require('http');

const testApi = (path) => {
    return new Promise((resolve) => {
        http.get(`http://localhost:5001/api${path}`, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    console.log(`✅ ${path}: ${Array.isArray(json) ? json.length : 'not an array'} items`);
                } catch (e) {
                    console.log(`❌ ${path} failed to parse JSON: ${data.substring(0, 100)}`);
                }
                resolve();
            });
        }).on('error', (err) => {
            console.log(`❌ ${path} failed: ${err.message}`);
            resolve();
        });
    });
};

const run = async () => {
    console.log('--- Testing API Endpoints ---');
    await testApi('/events');
    await testApi('/speakers');
    await testApi('/partners');
    await testApi('/agendas');
};

run();
