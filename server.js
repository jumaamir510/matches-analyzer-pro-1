const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

console.log("Deriv Transition AI Engine starting...")

const HISTORY_LIMIT = 2000
const SIGNAL_DURATION = 30000
const MIN_STRENGTH = 60
const MIN_DROUGHT = 20

const symbols = [
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const history={}
const drought={}
const frequency={}
const transitions={}
const lastPrice={}
const lastDigit={}
let activeSignals={}

symbols.forEach(s=>{
 history[s]=[]
 drought[s]=Array(10).fill(0)
 frequency[s]=Array(10).fill(0)

 transitions[s]=Array.from({length:10},()=>Array(10).fill(0))
})

const ws=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

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

 const data=JSON.parse(msg)
 if(!data.tick) return

 const symbol=data.tick.symbol
 const price=data.tick.quote
 const digit=parseInt(price.toFixed(2).slice(-1))

 lastPrice[symbol]=price

 const prevDigit=lastDigit[symbol]

 lastDigit[symbol]=digit

 const h=history[symbol]

 h.push(digit)

 frequency[symbol][digit]++

 if(prevDigit!==undefined){
  transitions[symbol][prevDigit][digit]++
 }

 if(h.length>HISTORY_LIMIT){

  const removed=h.shift()
  frequency[symbol][removed]--

 }

 if(h.length<200) return

 for(let i=0;i<10;i++){
  drought[symbol][i]++
 }

 drought[symbol][digit]=0

 if(activeSignals[symbol] && Date.now()<activeSignals[symbol].expiry){
  return
 }

 let bestDigit=0
 let bestScore=0

 for(let i=0;i<10;i++){

  const droughtScore=drought[symbol][i]

  const freq=frequency[symbol][i]/h.length
  const rarityScore=(0.1-freq)*100

  let transitionScore=0

  if(prevDigit!==undefined){

   const totalTransitions=transitions[symbol][prevDigit].reduce((a,b)=>a+b,0)

   if(totalTransitions>20){

    const prob=transitions[symbol][prevDigit][i]/totalTransitions

    transitionScore=prob*50

   }

  }

  const score=droughtScore+rarityScore+transitionScore

  if(score>bestScore){
   bestScore=score
   bestDigit=i
  }

 }

 const strength=Math.min(95,Math.floor(bestScore))

 if(strength<MIN_STRENGTH || drought[symbol][bestDigit]<MIN_DROUGHT){
  return
 }

 const entryDigit=(bestDigit+3)%10

 activeSignals[symbol]={

  symbol,
  matchDigit:bestDigit,
  entryDigit,
  strength,
  expiry:Date.now()+SIGNAL_DURATION

 }

})

app.get("/signals",(req,res)=>{

 const now=Date.now()

 const results=[]

 Object.keys(lastPrice).forEach(symbol=>{

  const signal=activeSignals[symbol]

  const expires=signal ? Math.max(0,Math.floor((signal.expiry-now)/1000)) : 0

  results.push({

   symbol,
   price:lastPrice[symbol],
   lastDigit:lastDigit[symbol],
   matchDigit:signal?signal.matchDigit:"-",
   entryDigit:signal?signal.entryDigit:"-",
   strength:signal?signal.strength:0,
   expires

  })

 })

 let best=null

 results.forEach(r=>{
  if(!best || r.strength>best.strength){
   best=r
  }
 })

 res.json({

  markets:results,
  best:best?best.symbol:null

 })

})

app.get("/",(req,res)=>{

res.send(`

<html>

<head>

<title>Deriv Transition AI Engine</title>

<style>

body{
background:#0f172a;
color:white;
font-family:Arial;
text-align:center;
}

table{
margin:auto;
margin-top:40px;
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

.best{
background:#1e293b;
font-weight:bold;
}

</style>

</head>

<body>

<h1>DERIV TRANSITION AI ENGINE</h1>

<table id="table">

<tr>
<th>Market</th>
<th>Price</th>
<th>Last Digit</th>
<th>Match Digit</th>
<th>Entry Digit</th>
<th>Strength</th>
<th>Expires</th>
</tr>

</table>

<script>

async function load(){

 const res=await fetch("/signals")

 const data=await res.json()

 const table=document.getElementById("table")

 table.innerHTML=\`

<tr>
<th>Market</th>
<th>Price</th>
<th>Last Digit</th>
<th>Match Digit</th>
<th>Entry Digit</th>
<th>Strength</th>
<th>Expires</th>
</tr>

\`

 data.markets.forEach(m=>{

  const best = m.symbol===data.best ? "best" : ""

  table.innerHTML+=\`

<tr class="\${best}">
<td>\${m.symbol} \${best?"⭐":""}</td>
<td>\${m.price||"-"}</td>
<td>\${m.lastDigit||"-"}</td>
<td>\${m.matchDigit}</td>
<td>\${m.entryDigit}</td>
<td>\${m.strength}%</td>
<td>\${m.expires}s</td>
</tr>

\`

 })

}

load()

setInterval(load,2000)

</script>

</body>

</html>

`)

})

app.listen(PORT,()=>{

 console.log("Server running on port",PORT)

})
