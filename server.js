const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const MEMORY = 50

const history = {}
const transitions = {}
const streak = {}
const lastDigit = {}
const lastPrice = {}

let signals = {}

symbols.forEach(s => {
  history[s] = []
  transitions[s] = Array.from({length:10},()=>Array(10).fill(0))
  streak[s] = 0
})

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open", () => {
  symbols.forEach(symbol => {
    ws.send(JSON.stringify({ticks:symbol,subscribe:1}))
  })
})

ws.on("message", (msg) => {

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

    if(prev === digit) streak[symbol]++
    else streak[symbol] = 1

  }

  const h = history[symbol]
  h.push(digit)

  if(h.length > MEMORY){
    h.shift()
  }

  if(h.length < 20) return

  let bestDigit = null
  let bestScore = 0
  let validity = 0

  // TRANSITION LOGIC
  if(prev !== undefined){

    const row = transitions[symbol][prev]
    const total = row.reduce((a,b)=>a+b,0)

    if(total > 10){

      for(let i=0;i<10;i++){

        const prob = row[i]/total

        if(prob > bestScore){
          bestScore = prob
          bestDigit = i
        }

      }

      if(bestScore > 0.25){

        signals[symbol] = {
          type: "TRANSITION",
          digit: bestDigit,
          strength: Math.floor(bestScore * 100),
          valid: Math.floor(bestScore * 10)
        }

        return
      }
    }
  }

  // PRESSURE BREAK LOGIC
  if(streak[symbol] >= 4){

    signals[symbol] = {
      type: "PRESSURE BREAK",
      digit: digit, // avoid this digit
      strength: 80,
      valid: 4
    }

    return
  }

  signals[symbol] = null

})

app.get("/signals", (req,res)=>{

  const markets = symbols.map(symbol => {

    const s = signals[symbol]

    return {

      symbol,
      price: lastPrice[symbol],
      last: lastDigit[symbol],
      signal: s ? s.digit : "-",
      type: s ? s.type : "WAIT",
      strength: s ? s.strength : 0,
      valid: s ? s.valid : 0

    }

  })

  res.json({markets})

})

app.get("/", (req,res)=>{

res.send(`

<html>

<head>

<title>Deriv Micro Engine</title>

<style>

body{
background:#0f172a;
color:white;
font-family:Arial;
text-align:center;
}

.grid{
display:grid;
grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
gap:20px;
padding:20px;
}

.card{
background:#1e293b;
padding:20px;
border-radius:12px;
}

.last{
font-size:30px;
}

.signal{
font-size:35px;
font-weight:bold;
}

</style>

</head>

<body>

<h1>DERIV MICRO ENGINE</h1>

<div class="grid" id="grid"></div>

<script>

async function load(){

const res = await fetch("/signals")
const data = await res.json()

const grid = document.getElementById("grid")
grid.innerHTML = ""

data.markets.forEach(m => {

grid.innerHTML += \`

<div class="card">

<div>\${m.price || "-"}</div>
<div>\${m.symbol}</div>

<div class="last">Last: \${m.last}</div>

<div class="signal">\${m.signal}</div>

<div>\${m.type}</div>

<div>Strength: \${m.strength}%</div>

<div>Valid: ~\${m.valid} ticks</div>

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

app.listen(PORT, ()=>{
console.log("Micro engine running")
})
