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
const MIN_TRANSITIONS = 25
const MIN_PROB = 0.35

const history = {}
const transitions = {}
const lastDigit = {}
const lastPrice = {}

const entryState = {}
const signals = {}
const performance = {}

symbols.forEach(s=>{
  history[s]=[]
  transitions[s]=Array.from({length:10},()=>Array(10).fill(0))
  entryState[s]=null

  performance[s]={
    wins:0,
    losses:0,
    last:[]
  }
})

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open", ()=>{
  symbols.forEach(symbol=>{
    ws.send(JSON.stringify({ticks:symbol,subscribe:1}))
  })
})

ws.on("message",(msg)=>{

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

  if(h.length < 30) return

  let best=null

  for(let entry=0;entry<10;entry++){

    const row = transitions[symbol][entry]
    const total = row.reduce((a,b)=>a+b,0)

    if(total < MIN_TRANSITIONS) continue

    for(let match=0;match<10;match++){

      const prob = row[match]/total

      if(prob >= MIN_PROB){
        if(!best || prob > best.prob){
          best={entry,match,prob}
        }
      }
    }
  }

  if(!best){
    signals[symbol]=null
    return
  }

  let state = entryState[symbol]

  if(!state){

    signals[symbol]={
      entry:best.entry,
      match:best.match,
      status:"WAIT ENTRY",
      strength:Math.floor(best.prob*100),
      valid:"-"
    }

    if(digit === best.entry){
      entryState[symbol]={
        match:best.match,
        ticks:CONFIRM_TICKS
      }
    }

    return
  }

  state.ticks--

  if(digit === state.match){

    performance[symbol].wins++
    performance[symbol].last.push("W")
    if(performance[symbol].last.length>20) performance[symbol].last.shift()

    signals[symbol]={
      entry:best.entry,
      match:state.match,
      status:"TRADE NOW",
      strength:100,
      valid:"NOW"
    }

    entryState[symbol]=null
    return
  }

  if(state.ticks <= 0){

    performance[symbol].losses++
    performance[symbol].last.push("L")
    if(performance[symbol].last.length>20) performance[symbol].last.shift()

    signals[symbol]={
      entry:best.entry,
      match:state.match,
      status:"EXPIRED",
      strength:0,
      valid:"0"
    }

    entryState[symbol]=null
    return
  }

  signals[symbol]={
    entry:best.entry,
    match:state.match,
    status:"WAIT CONFIRM",
    strength:80,
    valid:state.ticks+" ticks"
  }

})

app.get("/analyze",(req,res)=>{

  const market = req.query.market

  if(!market) return res.json({error:"No market"})

  const s = signals[market]
  const perf = performance[market]

  if(!s) return res.json({signal:null})

  const total = perf.wins + perf.losses
  const accuracy = total>0 ? Math.floor((perf.wins/total)*100) : 0

  if(accuracy < 55 && total >= 10){
    return res.json({signal:null})
  }

  res.json({
    market,
    price:lastPrice[market],
    last:lastDigit[market],
    entry:s.entry,
    match:s.match,
    status:s.status,
    valid:s.valid,
    accuracy,
    wins:perf.wins,
    losses:perf.losses,
    signal:true
  })

})

app.get("/",(req,res)=>{

res.send(`
<html>
<head>
<style>
body{background:#0f172a;color:white;font-family:Arial;text-align:center}
.container{padding:20px}
select,button{padding:10px;margin:10px;border-radius:8px;border:none}
.result{margin-top:20px;background:#1e293b;padding:20px;border-radius:12px}
.big{font-size:28px;font-weight:bold}
</style>
</head>

<body>

<h1>DERIV ANALYZE MODE</h1>

<div class="container">

<select id="market">
<option value="">-- Select Market --</option>
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

<button onclick="analyze()">ANALYZE</button>

<div id="output" class="result"></div>

</div>

<script>

async function analyze(){

const market=document.getElementById("market").value

if(!market){
  alert("Select market")
  return
}

const res = await fetch("/analyze?market="+market)
const data = await res.json()

const o=document.getElementById("output")

if(!data.signal){
  o.innerHTML="<div>No trade setup right now</div>"
  return
}

o.innerHTML=\`
<div>\${data.price}</div>
<div>\${data.market}</div>

<div>Last Digit: \${data.last}</div>

<div class="big">\${data.match}</div>
<div>Entry: \${data.entry}</div>

<div>Status: \${data.status}</div>
<div>Valid: \${data.valid}</div>

<hr>

<div>Accuracy: \${data.accuracy}%</div>
<div>W/L: \${data.wins}/\${data.losses}</div>
\`
}

</script>

</body>
</html>
`)
})

app.listen(PORT,()=>console.log("Analyze engine running"))
