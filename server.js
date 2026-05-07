const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const MEMORY = 50
const SHORT_MEMORY = 15

// SIGNAL SETTINGS
const SIGNAL_LIFETIME = 5000 // 5 seconds
const MIN_TRANSITIONS = 25
const MIN_PROB = 0.35

const history = {}
const shortHistory = {}
const transitions = {}

const lastDigit = {}
const lastPrice = {}

const entryState = {}
const signals = {}
const performance = {}

symbols.forEach(symbol=>{

  history[symbol] = []
  shortHistory[symbol] = []

  transitions[symbol] =
    Array.from({length:10},()=>Array(10).fill(0))

  entryState[symbol] = null

  performance[symbol] = {
    wins:0,
    losses:0,
    last:[]
  }

})

const ws = new WebSocket(
  "wss://ws.derivws.com/websockets/v3?app_id=1089"
)

ws.on("open",()=>{

  console.log("Connected to Deriv")

  symbols.forEach(symbol=>{

    ws.send(JSON.stringify({
      ticks:symbol,
      subscribe:1
    }))

  })

})

ws.on("message",(msg)=>{

  const data = JSON.parse(msg)

  if(!data.tick) return

  const symbol = data.tick.symbol
  const price = data.tick.quote

  const digit =
    parseInt(price.toFixed(2).slice(-1))

  lastPrice[symbol] = price

  const prev = lastDigit[symbol]
  lastDigit[symbol] = digit

  // BUILD TRANSITIONS
  if(prev !== undefined){

    transitions[symbol][prev][digit]++

  }

  // LONG MEMORY
  const h = history[symbol]

  h.push(digit)

  if(h.length > MEMORY){

    h.shift()

  }

  // SHORT MEMORY
  const sh = shortHistory[symbol]

  sh.push(digit)

  if(sh.length > SHORT_MEMORY){

    sh.shift()

  }

  // WAIT UNTIL ENOUGH DATA EXISTS
  if(h.length < 30){

    return

  }

  let best = null

  // ANALYZE TRANSITIONS
  for(let entry=0; entry<10; entry++){

    const row = transitions[symbol][entry]

    const total =
      row.reduce((a,b)=>a+b,0)

    if(total < MIN_TRANSITIONS){

      continue

    }

    for(let match=0; match<10; match++){

      const prob = row[match] / total

      // SHORT TERM VALIDATION
      let shortCount = 0
      let shortTotal = 0

      for(let i=1; i<sh.length; i++){

        if(sh[i-1] === entry){

          shortTotal++

          if(sh[i] === match){

            shortCount++

          }

        }

      }

      const shortProb =
        shortTotal > 0
          ? shortCount / shortTotal
          : 0

      // REQUIRE BOTH LONG + SHORT CONFIDENCE
      if(
        prob >= MIN_PROB &&
        shortProb >= 0.25
      ){

        const score =
          (prob * 0.7) +
          (shortProb * 0.3)

        if(
          !best ||
          score > best.score
        ){

          best = {
            entry,
            match,
            prob,
            shortProb,
            score
          }

        }

      }

    }

  }

  // NO VALID SETUP
  if(!best){

    signals[symbol] = null
    return

  }

  let state = entryState[symbol]

  // WAITING FOR ENTRY DIGIT
  if(!state){

    signals[symbol] = {

      entry:best.entry,
      match:best.match,

      status:"WAIT ENTRY",

      strength:
        Math.floor(best.score * 100),

      valid:"Waiting...",

      shortProb:best.shortProb

    }

    // ENTRY TOUCHED
    if(digit === best.entry){

      entryState[symbol] = {

        match:best.match,

        expires:
          Date.now() + SIGNAL_LIFETIME

      }

    }

    return

  }

  // MATCH HIT
  if(digit === state.match){

    performance[symbol].wins++

    performance[symbol].last.push("W")

    if(
      performance[symbol].last.length > 20
    ){

      performance[symbol].last.shift()

    }

    signals[symbol] = {

      entry:best.entry,
      match:state.match,

      status:"TRADE NOW",

      strength:100,

      valid:"NOW",

      shortProb:best.shortProb

    }

    entryState[symbol] = null

    return

  }

  // SIGNAL EXPIRED
  if(Date.now() > state.expires){

    performance[symbol].losses++

    performance[symbol].last.push("L")

    if(
      performance[symbol].last.length > 20
    ){

      performance[symbol].last.shift()

    }

    signals[symbol] = {

      entry:best.entry,
      match:state.match,

      status:"EXPIRED",

      strength:0,

      valid:"0s",

      shortProb:0

    }

    entryState[symbol] = null

    return

  }

  // WAITING FOR MATCH
  signals[symbol] = {

    entry:best.entry,
    match:state.match,

    status:"WAIT CONFIRM",

    strength:80,

    valid:
      Math.max(
        0,
        Math.floor(
          (state.expires - Date.now()) / 1000
        )
      ) + "s",

    shortProb:best.shortProb

  }

})

// ANALYZE ROUTE
app.get("/analyze",(req,res)=>{

  const market = req.query.market

  if(!market){

    return res.json({
      error:"No market selected"
    })

  }

  const s = signals[market]

  const perf = performance[market]

  if(!s){

    return res.json({
      signal:null
    })

  }

  const total =
    perf.wins + perf.losses

  const accuracy =
    total > 0
      ? Math.floor(
          (perf.wins / total) * 100
        )
      : 0

  res.json({

    signal:true,

    market,

    price:lastPrice[market],

    last:lastDigit[market],

    entry:s.entry,

    match:s.match,

    status:s.status,

    valid:s.valid,

    accuracy,

    stability:
      Math.floor(
        (s.shortProb || 0) * 100
      ),

    wins:perf.wins,

    losses:perf.losses

  })

})

// FRONTEND
app.get("/",(req,res)=>{

res.send(`

<html>

<head>

<title>Deriv Analyze Engine</title>

<style>

body{

  background:#0f172a;
  color:white;
  font-family:Arial;
  text-align:center;
  padding:30px;

}

select,button{

  padding:12px;
  margin:10px;
  border:none;
  border-radius:10px;
  font-size:16px;

}

button{

  cursor:pointer;

}

.card{

  margin:auto;
  margin-top:20px;

  background:#1e293b;

  width:320px;

  border-radius:15px;

  padding:20px;

}

.big{

  font-size:55px;
  font-weight:bold;
  margin:15px 0;

}

.status{

  font-size:22px;
  margin-top:10px;

}

</style>

</head>

<body>

<h1>DERIV ANALYZE ENGINE</h1>

<select id="market">

<option value="">Select Market</option>

<option value="R_10">R_10</option>
<option value="R_25">R_25</option>
<option value="R_50">R_50</option>
<option value="R_75">R_75</option>
<option value="R_100">R_100</option>

<option value="1HZ10V">1HZ10V</option>
<option value="1HZ25V">1HZ25V</option>
<option value="1HZ50V">1HZ50V</option>
<option value="1HZ75V">1HZ75V</option>
<option value="1HZ100V">1HZ100V</option>

</select>

<br>

<button onclick="analyze()">
ANALYZE
</button>

<div id="output"></div>

<script>

let selectedMarket = ""

setInterval(()=>{

  if(selectedMarket){

    analyze()

  }

},1000)

async function analyze(){

  const market =
    document.getElementById("market").value

  selectedMarket = market

  if(!market){

    return

  }

  const res =
    await fetch(
      "/analyze?market=" + market
    )

  const data = await res.json()

  const output =
    document.getElementById("output")

  if(!data.signal){

    output.innerHTML = \`
      <div class="card">
        No trade setup right now
      </div>
    \`

    return

  }

  output.innerHTML = \`

  <div class="card">

    <div>
      <b>\${data.market}</b>
    </div>

    <br>

    <div>
      Price:
      \${data.price}
    </div>

    <div>
      Last Digit:
      \${data.last}
    </div>

    <hr>

    <div>
      MATCH DIGIT
    </div>

    <div class="big">
      \${data.match}
    </div>

    <div>
      Entry Digit:
      <b>\${data.entry}</b>
    </div>

    <br>

    <div class="status">
      \${data.status}
    </div>

    <div>
      Valid:
      \${data.valid}
    </div>

    <hr>

    <div>
      Accuracy:
      \${data.accuracy}%
    </div>

    <div>
      Stability:
      \${data.stability}%
    </div>

    <div>
      W/L:
      \${data.wins}/\${data.losses}
    </div>

  </div>

  \`

}

</script>

</body>

</html>

`)
})

app.listen(PORT,()=>{

  console.log(
    "Deriv Analyze Engine running..."
  )

})
