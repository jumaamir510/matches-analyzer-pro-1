const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const MEMORY = 40
const SHORT_MEMORY = 12
const MIN_TRANSITIONS = 15
const MIN_PROB = 0.3

const history = {}
const shortHistory = {}
const transitions = {}
const lastDigit = {}
const lastPrice = {}

symbols.forEach(s=>{
  history[s]=[]
  shortHistory[s]=[]
  transitions[s]=Array.from({length:10},()=>Array(10).fill(0))
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

  lastPrice[symbol] = price

  const prev = lastDigit[symbol]
  lastDigit[symbol] = digit

  if(prev !== undefined){
    transitions[symbol][prev][digit]++
  }

  // long memory
  const h = history[symbol]
  h.push(digit)
  if(h.length > MEMORY) h.shift()

  // short memory
  const sh = shortHistory[symbol]
  sh.push(digit)
  if(sh.length > SHORT_MEMORY) sh.shift()

})


// 🔥 CORE: FIND BEST SIGNAL ACROSS ALL MARKETS
function getBestSignal(){

  let bestGlobal = null

  symbols.forEach(symbol=>{

    const h = history[symbol]
    const sh = shortHistory[symbol]

    if(h.length < 20) return

    let bestLocal = null

    for(let entry=0; entry<10; entry++){

      const row = transitions[symbol][entry]
      const total = row.reduce((a,b)=>a+b,0)

      if(total < MIN_TRANSITIONS) continue

      for(let match=0; match<10; match++){

        const prob = row[match] / total

        // short-term validation
        let shortCount = 0
        let shortTotal = 0

        for(let i=1;i<sh.length;i++){
          if(sh[i-1] === entry){
            shortTotal++
            if(sh[i] === match) shortCount++
          }
        }

        const shortProb = shortTotal > 0 ? shortCount / shortTotal : 0

        if(prob >= MIN_PROB && shortProb >= 0.25){

          const score = (prob * 0.7) + (shortProb * 0.3)

          if(!bestLocal || score > bestLocal.score){
            bestLocal = {
              symbol,
              entry,
              match,
              score,
              prob,
              shortProb
            }
          }
        }
      }
    }

    if(bestLocal){
      if(!bestGlobal || bestLocal.score > bestGlobal.score){
        bestGlobal = bestLocal
      }
    }

  })

  return bestGlobal
}


// 🔥 ANALYZE ROUTE
app.get("/analyze",(req,res)=>{

  const best = getBestSignal()

  if(!best){
    return res.json({signal:null})
  }

  // dynamic expiry (stronger = longer validity)
  const expiry = Math.max(3, Math.floor(best.score * 10))

  res.json({
    market: best.symbol,
    match: best.match,
    entry: best.entry,
    price: lastPrice[best.symbol],
    strength: Math.floor(best.score * 100),
    expires: expiry
  })

})


// 🔥 UI (SINGLE BIG CARD)
app.get("/",(req,res)=>{

res.send(`
<html>
<head>
<style>
body{
  background: radial-gradient(circle at top, #0f172a, #020617);
  color:white;
  font-family:Arial;
  display:flex;
  justify-content:center;
  align-items:center;
  height:100vh;
}

.card{
  width:320px;
  padding:30px;
  border-radius:20px;
  background:linear-gradient(145deg,#1e293b,#0f172a);
  box-shadow:0 0 30px rgba(0,255,150,0.3);
  text-align:center;
}

.market{
  font-size:18px;
  opacity:0.8;
}

.digit{
  font-size:80px;
  font-weight:bold;
  margin:20px 0;
  color:#22c55e;
}

.timer{
  font-size:22px;
  margin-top:10px;
}

.btn{
  margin-top:20px;
  padding:10px 20px;
  border:none;
  border-radius:10px;
  background:#22c55e;
  color:black;
  font-weight:bold;
  cursor:pointer;
}
</style>
</head>

<body>

<div class="card">

<div class="market" id="market">--</div>

<div class="digit" id="digit">-</div>

<div class="timer" id="timer">--</div>

<button class="btn" onclick="analyze()">ANALYZE</button>

</div>

<script>

let countdown = 0

async function analyze(){

  const res = await fetch("/analyze")
  const data = await res.json()

  if(!data.signal && !data.market){
    document.getElementById("digit").innerText = "-"
    document.getElementById("market").innerText = "No signal"
    document.getElementById("timer").innerText = ""
    return
  }

  document.getElementById("market").innerText = data.market
  document.getElementById("digit").innerText = data.match

  countdown = data.expires
}

setInterval(()=>{
  if(countdown > 0){
    countdown--
    document.getElementById("timer").innerText = countdown + " ticks"
  }
},1000)

</script>

</body>
</html>
`)
})

app.listen(PORT,()=>console.log("Sniper engine running"))
