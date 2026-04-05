const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

/*
CONFIG
*/

const TICK_LIMIT = 10000;
const SIGNAL_INTERVAL = 60000; // 1 minute
const DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089";

/*
MARKETS TO ANALYZE
*/

const markets = [
"R_10",
"R_25",
"R_50",
"R_75",
"R_100",
"1HZ10V",
"1HZ25V",
"1HZ50V",
"1HZ75V",
"1HZ100V"
];

/*
STORE TICKS
*/

let tickStorage = {};
let signals = {};

markets.forEach(m => {
    tickStorage[m] = [];
});

/*
CONNECT TO DERIV
*/

function connectDeriv(){

    const ws = new WebSocket(DERIV_WS);

    ws.on("open", () => {

        console.log("Connected to Deriv");

        markets.forEach(symbol => {

            ws.send(JSON.stringify({
                ticks: symbol,
                subscribe: 1
            }));

        });

    });

    ws.on("message", (data) => {

        const msg = JSON.parse(data);

        if(msg.tick){

            const symbol = msg.tick.symbol;
            const price = msg.tick.quote;

            const digit = parseInt(price.toString().slice(-1));

            tickStorage[symbol].push(digit);

            if(tickStorage[symbol].length > TICK_LIMIT){
                tickStorage[symbol].shift();
            }

        }

    });

    ws.on("close", () => {
        console.log("Deriv disconnected, reconnecting...");
        setTimeout(connectDeriv, 5000);
    });

}

connectDeriv();

/*
DIGIT ANALYSIS
*/

function analyzeDigits(digits){

    let freq = Array(10).fill(0);

    digits.forEach(d => {
        freq[d]++;
    });

    let maxDigit = 0;
    let maxCount = 0;

    freq.forEach((count, digit) => {

        if(count > maxCount){
            maxCount = count;
            maxDigit = digit;
        }

    });

    const strength = Math.round((maxCount / digits.length) * 100);

    return {
        digit: maxDigit,
        strength: strength
    };

}

/*
GENERATE SIGNALS
*/

function generateSignals(){

    markets.forEach(symbol => {

        const digits = tickStorage[symbol];

        if(digits.length < 100) return;

        const result = analyzeDigits(digits);

        signals[symbol] = {
            symbol: symbol,
            match_digit: result.digit,
            strength: result.strength,
            timestamp: Date.now()
        };

    });

}

setInterval(generateSignals, SIGNAL_INTERVAL);

/*
API
*/

app.get("/signals", (req,res) => {

    res.json(signals);

});

/*
SERVER
*/

app.get("/", (req,res)=>{
    res.send("Deriv Matches Analyzer Running");
});

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
