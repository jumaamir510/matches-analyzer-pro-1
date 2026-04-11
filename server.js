const express=require("express")
const WebSocket=require("ws")

const app=express()
const PORT=process.env.PORT||10000

const symbols=[
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const HISTORY_LIMIT=10000
const ENTRY_TICKS=15

const history={}
const freq={}
const drought={}
const transitions={}
const lastDigit={}
const lastPrice={}
const streak={}
const tickWindow={}

let signals={}

symbols.forEach(s=>{

history[s]=[]
freq[s]=Array(10).fill(0)
drought[s]=Array(10).fill(0)
transitions[s]=Array.from({length:10},()=>Array(10).fill(0))
streak[s]=0
tickWindow[s]=0

})

const ws=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open",()=>{

symbols.forEach(symbol=>{
ws.send(JSON.stringify({ticks:symbol,subscribe:1}))
})

})

ws.on("message",(msg)=>{

const data=JSON.parse(msg)
if(!data.tick)return

const symbol=data.tick.symbol
const price=data.tick.quote
const digit=parseInt(price.toFixed(2).slice(-1))

lastPrice[symbol]=price

const prev=lastDigit[symbol]
lastDigit[symbol]=digit

const h=history[symbol]

h.push(digit)
freq[symbol][digit]++

if(prev!==undefined){

transitions[symbol][prev][digit]++

if(prev===digit)streak[symbol]++
else streak[symbol]=1

}

if(h.length>HISTORY_LIMIT){

const removed=h.shift()
freq[symbol][removed]--

}

if(h.length<500)return

for(let i=0;i<10;i++)drought[symbol][i]++
drought[symbol][digit]=0

const sig=signals[symbol]

if(sig){

tickWindow[symbol]--

if(sig.stage==="WAIT ENTRY" && digit===sig.entry){

sig.stage="TRADE NOW"
sig.tradeDigit=digit
tickWindow[symbol]=1
return

}

if(tickWindow[symbol]<=0){

sig.stage="EXPIRED"

}

}

if(sig && sig.stage!=="EXPIRED")return

let bestDigit=0
let bestScore=0

for(let i=0;i<10;i++){

const droughtScore=drought[symbol][i]

const rarity=(0.1-(freq[symbol][i]/h.length))*100

let transitionScore=0

if(prev!==undefined){

const total=transitions[symbol][prev].reduce((a,b)=>a+b,0)

if(total>30){

const prob=transitions[symbol][prev][i]/total

transitionScore=prob*80

}

}

let pressure=0
if(streak[symbol]>=4 && i===digit)pressure=60

const score=droughtScore+rarity+transitionScore+pressure

if(score>bestScore){

bestScore=score
bestDigit=i

}

}

const entry=(bestDigit+3)%10

signals[symbol]={

match:bestDigit,
entry:entry,
stage:"WAIT ENTRY",
strength:Math.min(99,Math.floor(bestScore))

}

tickWindow[symbol]=ENTRY_TICKS

})

app.get("/signals",(req,res)=>{

const markets=[]

symbols.forEach(symbol=>{

const s=signals[symbol]

markets.push({

symbol,
price:lastPrice[symbol],
last:lastDigit[symbol],
match:s?s.match:"-",
entry:s?s.entry:"-",
stage:s?s.stage:"SCANNING",
window:tickWindow[symbol]

})

})

res.json({markets})

})

app.get("/",(req,res)=>{

res.send(`

<html>

<head>

<title>Deriv Tick Analyzer</title>

<style>

body{

background:#0f172a;
color:white;
font-family:Arial;
text-align:center;

}

.grid{

display:grid;
grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
gap:20px;
padding:20px;

}

.card{

background:#1e293b;
border-radius:14px;
padding:20px;
box-shadow:0 0 10px black;

}

.price{

font-size:18px;

}

.market{

font-size:13px;
color:#94a3b8;
margin-bottom:10px;

}

.last{

font-size:32px;
margin:10px 0;

}

.match{

font-size:28px;
font-weight:bold;

}

.entry{

color:#22c55e;

}

.stage{

margin-top:10px;

}

.window{

color:#fbbf24;

}

</style>

</head>

<body>

<h1>DERIV TICK ANALYZER</h1>

<div class="grid" id="grid"></div>

<script>

async function load(){

const res=await fetch("/signals")
const data=await res.json()

const grid=document.getElementById("grid")

grid.innerHTML=""

data.markets.forEach(m=>{

grid.innerHTML+=\`

<div class="card">

<div class="price">\${m.price||"-"}</div>

<div class="market">\${m.symbol}</div>

<div class="last">Last Digit: \${m.last}</div>

<div class="match">Match: \${m.match}</div>

<div class="entry">Entry Digit: \${m.entry}</div>

<div class="stage">\${m.stage}</div>

<div class="window">\${m.window} ticks</div>

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

app.listen(PORT,()=>{

console.log("Tick analyzer running")

})
