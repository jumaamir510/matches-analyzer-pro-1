const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

// ======================
// MARKETS
// ======================

const symbols = [
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
]

// ======================
// FAST + STABLE ENGINE
// ======================

const MEMORY = 40
const SHORT_MEMORY = 20

const MIN_TRANSITIONS = 7
const MIN_PROB = 0.24
const MIN_STABILITY = 0.35

const PRESSURE_WEIGHT = 0.75
const STABILITY_WEIGHT = 0.25

// ======================
// STORAGE
// ======================

const history = {}
const shortHistory = {}
const transitions = {}

const lastDigit = {}
const lastPrice = {}

let bestSignal = null

symbols.forEach(symbol => {

  history[symbol] = []
  shortHistory[symbol] = []

  transitions[symbol] =
    Array.from({ length:10 }, () =>
      Array(10).fill(0)
    )

})

// ======================
// DYNAMIC EXPIRY
// ======================

function dynamicExpiry(score){

  if(score >= 0.90) return 14
  if(score >= 0.80) return 12
  if(score >= 0.70) return 10
  if(score >= 0.60) return 8
  if(score >= 0.50) return 6

  return 5
}

// ======================
// DERIV WS
// ======================

const ws =
new WebSocket(
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

// ======================
// LIVE ENGINE
// ======================

ws.on("message",(msg)=>{

  const data = JSON.parse(msg)

  if(!data.tick) return

  const symbol = data.tick.symbol
  const price = data.tick.quote

  const digit =
  parseInt(
    price.toFixed(2).slice(-1)
  )

  lastPrice[symbol] = price

  const prev = lastDigit[symbol]
  lastDigit[symbol] = digit

  // ======================
  // BUILD TRANSITIONS
  // ======================

  if(prev !== undefined){

    transitions[symbol][prev][digit]++

  }

  // ======================
  // HISTORY
  // ======================

  const h = history[symbol]

  h.push(digit)

  if(h.length > MEMORY){
    h.shift()
  }

  const sh = shortHistory[symbol]

  sh.push(digit)

  if(sh.length > SHORT_MEMORY){
    sh.shift()
  }

  // fast startup

  if(h.length < 12){
    return
  }

  let localBest = null

  // ======================
  // ANALYSIS
  // ======================

  for(let entry=0; entry<10; entry++){

    const row =
    transitions[symbol][entry]

    const total =
    row.reduce((a,b)=>a+b,0)

    if(total < MIN_TRANSITIONS){
      continue
    }

    for(let match=0; match<10; match++){

      const prob =
      row[match] / total

      // ======================
      // SHORT TERM STABILITY
      // ======================

      let shortCount = 0
      let shortTotal = 0

      for(let i=1;i<sh.length;i++){

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

      if(
        prob >= MIN_PROB &&
        shortProb >= MIN_STABILITY
      ){

        const baseScore =
        (prob * PRESSURE_WEIGHT) +
        (shortProb * STABILITY_WEIGHT)

        // ======================
        // LIVE PRESSURE
        // ======================

        const recent =
        h.slice(-8)

        let pressureCount = 0

        for(let i=0;i<recent.length-1;i++){

          if(
            recent[i] === entry &&
            recent[i+1] === match
          ){
            pressureCount++
          }

        }

        const liveBoost =
        pressureCount / 8

        const finalScore =
        baseScore + (liveBoost * 0.15)

        if(
          !localBest ||
          finalScore > localBest.score
        ){

          localBest = {

            market:symbol,

            price,

            entry,

            match,

            last:digit,

            score:finalScore,

            strength:
            Math.floor(finalScore * 100)

          }

        }

      }

    }

  }

  if(!localBest){
    return
  }

  // ======================
  // GLOBAL BEST SIGNAL
  // ======================

  const expiry =
  dynamicExpiry(localBest.score)

  bestSignal = {

    ...localBest,

    expiry,
    created:Date.now()

  }

})

// ======================
// AUTO REFRESH
// ======================

setInterval(()=>{

  if(!bestSignal) return

  const elapsed =
  Math.floor(
    (Date.now() - bestSignal.created)
    / 1000
  )

  const remaining =
  bestSignal.expiry - elapsed

  if(remaining <= 0){

    bestSignal = null

  }

},1000)

// ======================
// API
// ======================

app.get("/best",(req,res)=>{

  if(!bestSignal){

    return res.json({
      active:false
    })

  }

  const elapsed =
  Math.floor(
    (Date.now() - bestSignal.created)
    / 1000
  )

  const remaining =
  bestSignal.expiry - elapsed

  if(remaining <= 0){

    bestSignal = null

    return res.json({
      active:false
    })

  }

  res.json({

    active:true,

    market:bestSignal.market,

    price:bestSignal.price,

    last:bestSignal.last,

    entry:bestSignal.entry,

    match:bestSignal.match,

    strength:bestSignal.strength,

    remaining

  })

})

// ======================
// HUGE GLOW UI
// ======================

app.get("/",(req,res)=>{

res.send(`

<html>

<head>

<title>
DERIV AI ENGINE
</title>

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
radial-gradient(
circle at top,
#111827,
#020617
);

overflow:hidden;

color:white;

}

.glow1{

position:absolute;

width:800px;
height:800px;

background:#22c55e;

filter:blur(220px);

opacity:0.18;

border-radius:50%;

top:-250px;
right:-250px;

animation:float 10s ease-in-out infinite;

}

.glow2{

position:absolute;

width:700px;
height:700px;

background:#3b82f6;

filter:blur(220px);

opacity:0.15;

border-radius:50%;

bottom:-250px;
left:-250px;

animation:float2 12s ease-in-out infinite;

}

@keyframes float{

0%{
transform:translateY(0px)
}

50%{
transform:translateY(40px)
}

100%{
transform:translateY(0px)
}

}

@keyframes float2{

0%{
transform:translateY(0px)
}

50%{
transform:translateY(-40px)
}

100%{
transform:translateY(0px)
}

}

.card{

position:relative;

z-index:10;

width:560px;
height:760px;

background:
rgba(15,23,42,0.78);

border:
1px solid rgba(255,255,255,0.08);

backdrop-filter:blur(30px);

border-radius:40px;

padding:40px;

display:flex;
flex-direction:column;
justify-content:space-between;
align-items:center;

box-shadow:
0 0 60px rgba(0,0,0,0.45);

}

.market{

font-size:34px;
font-weight:bold;

color:#cbd5e1;

letter-spacing:3px;

text-align:center;

margin-top:10px;

}

.price{

font-size:28px;

color:#94a3b8;

margin-top:15px;

}

.label{

font-size:16px;

letter-spacing:4px;

color:#64748b;

margin-top:25px;

}

.digit{

font-size:240px;
font-weight:900;

line-height:1;

margin-top:10px;

background:
linear-gradient(
180deg,
#ffffff,
#22c55e
);

-webkit-background-clip:text;
-webkit-text-fill-color:transparent;

text-shadow:
0 0 40px rgba(34,197,94,0.45);

}

.timer{

font-size:80px;
font-weight:900;

margin-top:15px;

color:#f8fafc;

}

.timerSub{

font-size:16px;

color:#94a3b8;

margin-top:8px;

}

.footer{

width:100%;

display:flex;
justify-content:space-between;

margin-top:25px;

}

.box{

flex:1;

margin:8px;

padding:25px;

background:
rgba(255,255,255,0.05);

border-radius:25px;

text-align:center;

}

.boxTitle{

font-size:14px;

letter-spacing:2px;

color:#94a3b8;

margin-bottom:10px;

}

.boxValue{

font-size:44px;
font-weight:bold;

}

.wait{

font-size:40px;
font-weight:bold;

color:#22c55e;

margin-top:30px;

animation:pulse 1.5s infinite;

}

@keyframes pulse{

0%{
opacity:0.5
}

50%{
opacity:1
}

100%{
opacity:0.5
}

}

</style>

</head>

<body>

<div class="glow1"></div>
<div class="glow2"></div>

<div class="card">

<div
class="market"
id="market"
>

SCANNING MARKET...

</div>

<div
class="price"
id="price"
>

WAITING FOR LIVE DATA

</div>

<div>

<div class="label">
MATCH DIGIT
</div>

<div
class="digit"
id="digit"
>

-

</div>

</div>

<div>

<div
class="timer"
id="timer"
>

--

</div>

<div class="timerSub">
SIGNAL VALIDITY
</div>

</div>

<div class="footer">

<div class="box">

<div class="boxTitle">
ENTRY
</div>

<div
class="boxValue"
id="entry"
>

-

</div>

</div>

<div class="box">

<div class="boxTitle">
STRENGTH
</div>

<div
class="boxValue"
id="strength"
>

0%

</div>

</div>

</div>

<div
class="wait"
id="status"
>

ANALYZING...

</div>

</div>

<script>

async function load(){

try{

const res =
await fetch("/best")

const data =
await res.json()

if(!data.active){

document
.getElementById("status")
.innerText =
"SCANNING..."

return

}

document
.getElementById("market")
.innerText =
data.market

document
.getElementById("price")
.innerText =
"LIVE PRICE: " + data.price

document
.getElementById("digit")
.innerText =
data.match

document
.getElementById("entry")
.innerText =
data.entry

document
.getElementById("strength")
.innerText =
data.strength + "%"

document
.getElementById("timer")
.innerText =
data.remaining + "s"

document
.getElementById("status")
.innerText =
"ENTER NOW"

}catch(err){

console.log(err)

}

}

// FAST REFRESH

setInterval(load,500)

</script>

</body>

</html>

`)

})

// ======================
// START SERVER
// ======================

app.listen(PORT,()=>{

console.log(
"DERIV AI ENGINE RUNNING"
)

})
