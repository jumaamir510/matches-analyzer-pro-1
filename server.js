const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

console.log("Deriv AI Digit Engine starting...")

const HISTORY_LIMIT = 10000
const ENTRY_COOLDOWN = 5
const TRADE_WINDOW = 5

let MIN_DROUGHT = 25
let MIN_STRENGTH = 60

let stats = {wins:0,losses:0}

let signals = {}
let openTrades=[]

const symbols=[
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const history={}
const drought={}
const frequency={}
const lastSeen={}
const lastPrice={}
const lastDigit={}

symbols.forEach(s=>{
history[s]=[]
drought[s]=Array(10).fill(0)
frequency[s]=Array(10).fill(0)
lastSeen[s]=Array(10).fill(999)
})

const ws=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open",()=>{

console.log("Connected to Deriv")

symbols.forEach(symbol=>{
ws.send(JSON.stringify({ticks:symbol,subscribe:1}))
})

})

ws.on("message",(msg)=>{

const data=JSON.parse(msg)

if(!data.tick) return

const symbol=data.tick.symbol
const price=data.tick.quote
const digit=parseInt(price.toFixed(2).slice(-1))

lastPrice[symbol]=price
lastDigit[symbol]=digit

const h=history[symbol]

h.push(digit)

frequency[symbol][digit]++

if(h.length>HISTORY_LIMIT){

const removed=h.shift()
frequency[symbol][removed]--

}

if(h.length<200) return

for(let i=0;i<10;i++){
drought[symbol][i]++
lastSeen[symbol][i]++
}

drought[symbol][digit]=0
lastSeen[symbol][digit]=0

checkOpenTrades(symbol,digit)

let bestDigit=0
let bestScore=0

for(let i=0;i<10;i++){

const droughtScore=drought[symbol][i]
const freq=frequency[symbol][i]/h.length
const rarityScore=(0.1-freq)*100

const score=droughtScore+rarityScore

if(score>bestScore){

bestScore=score
bestDigit=i

}

}

const strength=Math.min(95,Math.floor(bestScore))

const entryDigit=(bestDigit+2)%10

let entry="WAIT"

if(
strength>=MIN_STRENGTH &&
drought[symbol][bestDigit]>=MIN_DROUGHT &&
digit===entryDigit
){

entry="ENTER"

openTrades.push({
symbol,
digit:bestDigit,
ticksLeft:TRADE_WINDOW
})

}

signals[symbol]={

symbol,
price,
lastDigit:digit,
matchDigit:bestDigit,
entryDigit,
strength,
entry

}

})

function checkOpenTrades(symbol,digit){

openTrades.forEach((t,i)=>{

if(t.symbol!==symbol) return

if(digit===t.digit){

stats.wins++
openTrades.splice(i,1)
adjustLearning()
return

}

t.ticksLeft--

if(t.ticksLeft<=0){

stats.losses++
openTrades.splice(i,1)
adjustLearning()

}

})

}

function adjustLearning(){

const total=stats.wins+stats.losses

if(total<20) return

const winrate=stats.wins/total

if(winrate<0.5){
MIN_DROUGHT+=2
}

if(winrate>0.65){
MIN_DROUGHT=Math.max(20,MIN_DROUGHT-1)
}

}

app.get("/signals",(req,res)=>{

res.json({
signals,
stats
})

})

app.get("/",(req,res)=>{

res.send(`

<html>

<head>

<title>Deriv AI Digit Engine</title>

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

<h1>DERIV AI DIGIT ENGINE</h1>

<table id="table">

<tr>
<th>Market</th>
<th>Price</th>
<th>Last Digit</th>
<th>Match Digit</th>
<th>Entry Digit</th>
<th>Strength</th>
<th>Status</th>
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
<th>Status</th>
</tr>

\`

Object.values(data.signals).forEach(s=>{

const status=s.entry==="ENTER"?"enter":"wait"

table.innerHTML+=\`

<tr>

<td>\${s.symbol}</td>
<td>\${s.price}</td>
<td>\${s.lastDigit}</td>
<td>\${s.matchDigit}</td>
<td>\${s.entryDigit}</td>
<td>\${s.strength}%</td>
<td class="\${status}">\${s.entry}</td>

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
