const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

// =======================
// CONFIG
// =======================

const symbols = [
  "1HZ10V",
  "1HZ25V",
  "1HZ50V",
  "1HZ75V",
  "1HZ100V",
  "R_10",
  "R_25",
  "R_50",
  "R_75",
  "R_100"
]

const MEMORY = 50
const MIN_CONFIDENCE = 58
const CONFIRM_TICKS = 4

// =======================
// STORAGE
// =======================

const tickHistory = {}
const transitions = {}
const transitionTiming = {}
const currentTick = {}
const currentDigit = {}
const activeSignals = {}

symbols.forEach(symbol => {

  tickHistory[symbol] = []

  transitions[symbol] =
    Array.from({ length: 10 }, () =>
      Array(10).fill(0)
    )

  transitionTiming[symbol] =
    Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => [])
    )

})

// =======================
// DERIV SOCKET
// =======================

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open", () => {

  console.log("Connected to Deriv")

  symbols.forEach(symbol => {

    ws.send(JSON.stringify({
      ticks: symbol,
      subscribe: 1
    }))

  })

})

ws.on("message", msg => {

  const data = JSON.parse(msg)

  if (!data.tick) return

  const symbol = data.tick.symbol
  const price = data.tick.quote

  currentTick[symbol] = price

  const digit =
    parseInt(price.toString().slice(-1))

  currentDigit[symbol] = digit

  tickHistory[symbol].push(digit)

  if (tickHistory[symbol].length > MEMORY) {
    tickHistory[symbol].shift()
  }

  const history = tickHistory[symbol]

  if (history.length >= 2) {

    const prev = history[history.length - 2]

    transitions[symbol][prev][digit]++

    // =======================
    // LEARN TRANSITION TIMING
    // =======================

    const active = activeSignals[symbol]

    if (
      active &&
      active.entry === prev
    ) {

      const delay = active.age || 1

      transitionTiming[symbol][prev][digit].push(delay)

      if (
        transitionTiming[symbol][prev][digit].length > 30
      ) {
        transitionTiming[symbol][prev][digit].shift()
      }

    }

  }

  // =======================
  // UPDATE ACTIVE SIGNALS
  // =======================

  Object.keys(activeSignals).forEach(s => {

    const signal = activeSignals[s]

    signal.ticks--

    signal.age = (signal.age || 0) + 1

    if (signal.ticks <= 0) {
      delete activeSignals[s]
    }

  })

  // =======================
  // FIND BEST SIGNAL
  // =======================

  let bestSignal = null

  symbols.forEach(symbol => {

    const history = tickHistory[symbol]

    if (history.length < 20) return

    let best = null

    for (let entry = 0; entry <= 9; entry++) {

      const row = transitions[symbol][entry]

      const total =
        row.reduce((a, b) => a + b, 0)

      if (total < 10) continue

      let highest = 0
      let matchDigit = null

      for (let d = 0; d <= 9; d++) {

        const probability =
          (row[d] / total) * 100

        if (probability > highest) {

          highest = probability
          matchDigit = d

        }

      }

      if (highest >= MIN_CONFIDENCE) {

        best = {
          symbol,
          entry,
          match: matchDigit,
          confidence: Math.round(highest)
        }

      }

    }

    if (best) {

      if (
        !bestSignal ||
        best.confidence > bestSignal.confidence
      ) {

        bestSignal = best

      }

    }

  })

  // =======================
  // STORE SIGNAL
  // =======================

  if (bestSignal) {

    const symbol = bestSignal.symbol

    const timing =
      transitionTiming[symbol][bestSignal.entry][bestSignal.match]

    let adaptiveTicks = CONFIRM_TICKS

    if (timing.length >= 5) {

      const avg =
        timing.reduce((a, b) => a + b, 0) /
        timing.length

      adaptiveTicks =
        Math.max(
          2,
          Math.min(8, Math.round(avg))
        )

    }

    activeSignals[symbol] = {

      ...bestSignal,

      ticks: adaptiveTicks,

      age: 0

    }

  }

})

// =======================
// API
// =======================

app.get("/best", (req, res) => {

  let strongest = null

  Object.values(activeSignals).forEach(signal => {

    if (
      !strongest ||
      signal.confidence > strongest.confidence
    ) {
      strongest = signal
    }

  })

  if (!strongest) {

    return res.json({
      signal: false
    })

  }

  res.json({

    signal: true,

    market: strongest.symbol,

    match: strongest.match,

    entry: strongest.entry,

    strength: strongest.confidence,

    valid: strongest.ticks + "s",

    status:
      strongest.confidence >= 75
        ? "ENTER NOW"
        : strongest.confidence >= 65
        ? "WATCH"
        : "WAIT"

  })

})

// =======================
// UI
// =======================

app.get("/", (req, res) => {

res.send(`
<html>
<head>
<title>Deriv AI Signal Engine</title>

<style>

*{
margin:0;
padding:0;
box-sizing:border-box;
font-family:Arial;
}

body{
height:100vh;
display:flex;
justify-content:center;
align-items:center;
background:
linear-gradient(135deg,#020617,#0f172a,#111827);
overflow:hidden;
color:white;
}

.bg{
position:absolute;
width:600px;
height:600px;
background:#22c55e;
filter:blur(180px);
opacity:0.15;
border-radius:50%;
top:-150px;
right:-150px;
animation:float 8s ease-in-out infinite;
}

.bg2{
position:absolute;
width:500px;
height:500px;
background:#3b82f6;
filter:blur(180px);
opacity:0.12;
border-radius:50%;
bottom:-150px;
left:-150px;
animation:float2 10s ease-in-out infinite;
}

@keyframes float{
0%{transform:translateY(0px)}
50%{transform:translateY(30px)}
100%{transform:translateY(0px)}
}

@keyframes float2{
0%{transform:translateY(0px)}
50%{transform:translateY(-30px)}
100%{transform:translateY(0px)}
}

.card{

position:relative;
z-index:10;

width:420px;
min-height:520px;

background:
rgba(15,23,42,0.75);

border:
1px solid rgba(255,255,255,0.08);

backdrop-filter:blur(25px);

border-radius:30px;

padding:30px;

box-shadow:
0 0 40px rgba(0,0,0,0.45);

display:flex;
flex-direction:column;
justify-content:space-between;
align-items:center;

}

.market{
font-size:20px;
font-weight:bold;
letter-spacing:2px;
color:#94a3b8;
margin-top:5px;
}

.signalDigit{

font-size:170px;
font-weight:900;
line-height:1;

margin-top:20px;

background:linear-gradient(180deg,#ffffff,#22c55e);

-webkit-background-clip:text;
-webkit-text-fill-color:transparent;

text-shadow:
0 0 25px rgba(34,197,94,0.45);

}

.label{
font-size:14px;
letter-spacing:3px;
color:#64748b;
margin-top:10px;
}

.status{

margin-top:25px;

padding:12px 30px;

border-radius:999px;

background:
linear-gradient(90deg,#16a34a,#22c55e);

font-weight:bold;

font-size:16px;

box-shadow:
0 0 20px rgba(34,197,94,0.35);

}

.timer{

margin-top:30px;

font-size:60px;
font-weight:900;

color:#f8fafc;

}

.sub{
margin-top:8px;
font-size:14px;
color:#94a3b8;
}

.footer{

margin-top:35px;
width:100%;

display:flex;
justify-content:space-between;
align-items:center;

padding-top:20px;

border-top:
1px solid rgba(255,255,255,0.08);

}

.smallBox{

flex:1;

background:
rgba(255,255,255,0.04);

margin:5px;

padding:15px;

border-radius:16px;

text-align:center;

}

.smallTitle{
font-size:12px;
color:#94a3b8;
margin-bottom:8px;
}

.smallValue{
font-size:24px;
font-weight:bold;
}

</style>
</head>

<body>

<div class="bg"></div>
<div class="bg2"></div>

<div class="card">

<div class="market" id="market">
SCANNING MARKET...
</div>

<div>

<div class="label">
MATCH DIGIT
</div>

<div class="signalDigit" id="digit">
-
</div>

</div>

<div class="status" id="status">
ANALYZING...
</div>

<div>

<div class="timer" id="timer">
--
</div>

<div class="sub">
SIGNAL VALIDITY
</div>

</div>

<div class="footer">

<div class="smallBox">
<div class="smallTitle">
ENTRY
</div>
<div class="smallValue" id="entry">
-
</div>
</div>

<div class="smallBox">
<div class="smallTitle">
STRENGTH
</div>
<div class="smallValue" id="strength">
0%
</div>
</div>

</div>

</div>

<script>

async function loadSignal(){

try{

const res = await fetch("/best")
const data = await res.json()

if(!data.signal){
return
}

document.getElementById("market").innerText=data.market

document.getElementById("digit").innerText=data.match

document.getElementById("entry").innerText=data.entry

document.getElementById("strength").innerText=data.strength+"%"

document.getElementById("status").innerText=data.status

document.getElementById("timer").innerText=data.valid

}catch(err){
console.log(err)
}

}

setInterval(loadSignal,1000)

</script>

</body>
</html>
`)

})

// =======================
// START SERVER
// =======================

app.listen(PORT, () => {
  console.log("Deriv AI Signal Engine running...")
})
