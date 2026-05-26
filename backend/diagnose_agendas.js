const http = require('http');

const testApi = (path) => {
    return new Promise((resolve) => {
        http.get(`http://localhost:5001/api${path}`, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`--- Response for ${path} ---`);
                console.log('Status:', res.statusCode);
                try {
                    const json = JSON.parse(data);
                    console.log('Type:', typeof json);
                    console.log('Is Array:', Array.isArray(json));
                    if (Array.isArray(json)) {
                        console.log('Length:', json.length);
                        if (json.length > 0) {
                            console.log('First Item:', JSON.stringify(json[0], null, 2));
                        }
                    } else {
                        console.log('Content:', data);
                    }
                } catch (e) {
                    console.log('Raw Content:', data);
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
    await testApi('/agendas');
};

run();
