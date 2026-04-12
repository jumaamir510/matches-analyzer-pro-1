const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const MEMORY = 50
const CONFIRM_TICKS = 3
const MIN_TRANSITIONS = 30
const MIN_PROB = 0.35

const history = {}
const transitions = {}
const lastDigit = {}
const lastPrice = {}
const entryState = {}
const signals = {}

symbols.forEach(s=>{
  history[s]=[]
  transitions[s]=Array.from({length:10},()=>Array(10).fill(0))
  entryState[s]=null
})

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open", ()=>{
  symbols.forEach(symbol=>{
    ws.send(JSON.stringify({ticks:symbol,subscribe:1}))
  })
})

ws.on("message", (msg)=>{

  const data = JSON.parse(msg)
  if(!data.tick) return

  const symbol = data.tick.symbol
  const price = data.tick.quote
  const digit = parseInt(price.toFixed(2).slice(-1))

  lastPrice[symbol]=price

  const prev = lastDigit[symbol]
  lastDigit[symbol]=digit

  if(prev!==undefined){
    transitions[symbol][prev][digit]++
  }

  const h = history[symbol]
  h.push(digit)
  if(h.length>MEMORY) h.shift()

  if(h.length<30) return

  let best = null

  // FIND BEST ENTRY → MATCH PAIR
  for(let entry=0;entry<10;entry++){

    const row = transitions[symbol][entry]
    const total = row.reduce((a,b)=>a+b,0)

    if(total < MIN_TRANSITIONS) continue

    for(let match=0;match<10;match++){

      const prob = row[match]/total

      if(prob >= MIN_PROB){

        if(!best || prob > best.prob){
          best = {entry, match, prob}
        }

      }

    }
  }

  if(!best){
    signals[symbol]=null
    return
  }

  // HANDLE ENTRY STATE
  let state = entryState[symbol]

  if(!state){

    signals[symbol]={
      entry: best.entry,
      match: best.match,
      status: "WAIT ENTRY",
      strength: Math.floor(best.prob*100),
      valid: "-"
    }

    if(digit === best.entry){
      entryState[symbol]={
        match: best.match,
        ticks: CONFIRM_TICKS
      }
    }

    return
  }

  // WAIT CONFIRM
  state.ticks--

  if(digit === state.match){

    signals[symbol]={
      entry: best.entry,
      match: state.match,
      status: "TRADE NOW",
      strength: 100,
      valid: "NOW"
    }

    entryState[symbol]=null
    return
  }

  if(state.ticks <= 0){

    signals[symbol]={
      entry: best.entry,
      match: state.match,
      status: "EXPIRED",
      strength: 0,
      valid: "0"
    }

    entryState[symbol]=null
    return
  }

  signals[symbol]={
    entry: best.entry,
    match: state.match,
    status: "WAIT CONFIRM",
    strength: 80,
    valid: state.ticks + " ticks"
  }

})

app.get("/signals",(req,res)=>{

  let maxStrength = 0

  const markets = symbols.map(symbol=>{
    const s = signals[symbol]

    if(s && s.strength > maxStrength){
      maxStrength = s.strength
    }

    return {
      symbol,
      price:lastPrice[symbol],
      last:lastDigit[symbol],
      ...s
    }
  })

  markets.forEach(m=>{
    m.best = m.strength === maxStrength && maxStrength > 0
  })

  res.json({markets})

})

app.get("/",(req,res)=>{

res.send(`

<html>
<head>
<style>
body{background:#0f172a;color:white;font-family:Arial;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;padding:20px}
.card{background:#1e293b;padding:20px;border-radius:12px}
.best{border:2px solid #22c55e;box-shadow:0 0 15px #22c55e}
.signal{font-size:30px;font-weight:bold}
</style>
</head>

<body>

<h1>SNIPER SEQUENCE ENGINE</h1>

<div class="grid" id="grid"></div>

<script>

async function load(){

const res=await fetch("/signals")
const data=await res.json()

const grid=document.getElementById("grid")
grid.innerHTML=""

data.markets.forEach(m=>{

grid.innerHTML+=\`

<div class="card \${m.best?"best":""}">

<div>\${m.price||"-"}</div>
<div>\${m.symbol}</div>

<div>Last: \${m.last||"-"}</div>

<div class="signal">\${m.match||"-"}</div>

<div>Entry: \${m.entry||"-"}</div>

<div>\${m.status||"WAIT"}</div>

<div>\${m.valid||""}</div>

</div>

\`

})

}

load()
setInterval(load,1000)

</script>

</body>
</html>

`)

})

app.listen(PORT,()=>console.log("Sniper engine running"))
