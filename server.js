const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

console.log("Deriv Matches Pro Analyzer starting...")

const SIGNAL_EXPIRY = 20000
const HISTORY_LIMIT = 300

let signals = {}

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const history = {}
const drought = {}

symbols.forEach(s=>{
 history[s] = []
 drought[s] = Array(10).fill(0)
})

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

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

 const digit = parseInt(price.toFixed(2).slice(-1))

 const h = history[symbol]

 h.push(digit)

 if(h.length>HISTORY_LIMIT) h.shift()

 if(h.length<40) return

 for(let i=0;i<10;i++){
  drought[symbol][i]++
 }

 drought[symbol][digit]=0

 let bestDigit = 0
 let longest = drought[symbol][0]

 for(let i=1;i<10;i++){
  if(drought[symbol][i]>longest){
   longest=drought[symbol][i]
   bestDigit=i
  }
 }

 const strength = Math.min(95,Math.floor(longest*2))

 signals[symbol]={
  symbol,
  digit:bestDigit,
  strength,
  drought:longest,
  expiry:Date.now()+SIGNAL_EXPIRY
 }

})

app.get("/signals",(req,res)=>{

 const now = Date.now()

 const active={}

 Object.values(signals).forEach(s=>{
  if(s.expiry>now){
   active[s.symbol]=s
  }
 })

 res.json(active)

})

app.get("/",(req,res)=>{

res.send(`
<html>
<head>

<title>Deriv Matches Pro Analyzer</title>

<style>

body{
background:#0f172a;
color:white;
font-family:Arial;
text-align:center;
}

h1{
margin-top:30px;
}

table{
margin:auto;
margin-top:30px;
border-collapse:collapse;
width:85%;
}

td,th{
border:1px solid #334155;
padding:10px;
}

th{
background:#1e293b;
}

.good{color:#22c55e}
.medium{color:#facc15}
.weak{color:#ef4444}

.best{
background:#1e293b;
}

</style>

</head>

<body>

<h1>DERIV MATCHES PRO ANALYZER</h1>

<table id="table">

<tr>
<th>Market</th>
<th>Digit</th>
<th>Strength</th>
<th>Drought</th>
<th>Expires</th>
</tr>

</table>

<script>

async function load(){

 const res = await fetch("/signals")
 const data = await res.json()

 const table = document.getElementById("table")

 table.innerHTML=\`
<tr>
<th>Market</th>
<th>Digit</th>
<th>Strength</th>
<th>Drought</th>
<th>Expires</th>
</tr>\`

 let bestStrength=0
 let bestSymbol=null

 Object.values(data).forEach(s=>{
  if(s.strength>bestStrength){
   bestStrength=s.strength
   bestSymbol=s.symbol
  }
 })

 Object.values(data).forEach(s=>{

  let status="weak"
  if(s.strength>70) status="good"
  else if(s.strength>50) status="medium"

  const expire=Math.floor((s.expiry-Date.now())/1000)

  const best = s.symbol===bestSymbol ? "best" : ""

  table.innerHTML+=\`
  <tr class="\${best}">
  <td>\${s.symbol}</td>
  <td>\${s.digit}</td>
  <td class="\${status}">\${s.strength}%</td>
  <td>\${s.drought}</td>
  <td>\${expire}s</td>
  </tr>\`

 })

}

load()

setInterval(load,3000)

</script>

</body>

</html>
`)

})

app.listen(PORT,()=>{
 console.log("Server running on port",PORT)
})
