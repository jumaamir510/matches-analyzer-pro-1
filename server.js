const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

console.log("Deriv Matches Pro Analyzer starting...")

const HISTORY_LIMIT = 10000
const SIGNAL_EXPIRY = 20000

const MIN_DROUGHT = 25
const MIN_STRENGTH = 60
const ENTRY_COOLDOWN = 5

let signals = {}

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const history = {}
const drought = {}
const frequency = {}
const lastSeen = {}

symbols.forEach(s=>{
 history[s]=[]
 drought[s]=Array(10).fill(0)
 frequency[s]=Array(10).fill(0)
 lastSeen[s]=Array(10).fill(999)
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

 frequency[symbol][digit]++

 if(h.length>HISTORY_LIMIT){

  const removed = h.shift()
  frequency[symbol][removed]--

 }

 if(h.length<200) return

 for(let i=0;i<10;i++){
  drought[symbol][i]++
  lastSeen[symbol][i]++
 }

 drought[symbol][digit]=0
 lastSeen[symbol][digit]=0

 let bestDigit=0
 let bestScore=0

 for(let i=0;i<10;i++){

  const droughtScore = drought[symbol][i]

  const freq = frequency[symbol][i] / h.length

  const rarityScore = (0.1 - freq) * 100

  const score = droughtScore + rarityScore

  if(score>bestScore){

   bestScore=score
   bestDigit=i

  }

 }

 const strength = Math.min(95,Math.floor(bestScore))

 let entry = "WAIT"

 if(
  strength >= MIN_STRENGTH &&
  drought[symbol][bestDigit] >= MIN_DROUGHT &&
  lastSeen[symbol][bestDigit] > ENTRY_COOLDOWN
 ){
  entry = "ENTER"
 }

 signals[symbol]={

  symbol,
  digit:bestDigit,
  strength,
  drought:drought[symbol][bestDigit],
  freq:(frequency[symbol][bestDigit]/h.length).toFixed(3),
  entry,
  expiry:Date.now()+SIGNAL_EXPIRY

 }

})

app.get("/signals",(req,res)=>{

 const now=Date.now()

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
width:90%;
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

.enter{
color:#22c55e;
font-weight:bold;
}

.wait{
color:#ef4444;
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
<th>Frequency</th>
<th>Entry</th>
</tr>

</table>

<script>

async function load(){

 const res = await fetch("/signals")
 const data = await res.json()

 const table=document.getElementById("table")

 table.innerHTML=\`
<tr>
<th>Market</th>
<th>Digit</th>
<th>Strength</th>
<th>Drought</th>
<th>Frequency</th>
<th>Entry</th>
</tr>\`

 Object.values(data).forEach(s=>{

  let status="weak"

  if(s.strength>70) status="good"
  else if(s.strength>50) status="medium"

  const entryClass = s.entry==="ENTER" ? "enter" : "wait"

  table.innerHTML+=\`

  <tr>
  <td>\${s.symbol}</td>
  <td>\${s.digit}</td>
  <td class="\${status}">\${s.strength}%</td>
  <td>\${s.drought}</td>
  <td>\${s.freq}</td>
  <td class="\${entryClass}">\${s.entry}</td>
  </tr>

  \`

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
