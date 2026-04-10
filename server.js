const express=require("express")
const WebSocket=require("ws")

const app=express()
const PORT=process.env.PORT||10000

const symbols=[
"R_10","R_25","R_50","R_75","R_100",
"1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"
]

const HISTORY_LIMIT=10000
const SIGNAL_WINDOW=25000

const history={}
const freq={}
const drought={}
const transitions={}
const lastDigit={}
const lastPrice={}
const streak={}

let signals={}
let outcomes={}

symbols.forEach(s=>{

history[s]=[]
freq[s]=Array(10).fill(0)
drought[s]=Array(10).fill(0)
transitions[s]=Array.from({length:10},()=>Array(10).fill(0))
streak[s]=0
outcomes[s]={win:0,loss:0}

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

if(signals[symbol]&&Date.now()<signals[symbol].expiry)return

let bestDigit=0
let bestScore=0

for(let i=0;i<10;i++){

const droughtScore=drought[symbol][i]

const rarity=(0.1-(freq[symbol][i]/h.length))*120

let transitionScore=0

if(prev!==undefined){

const total=transitions[symbol][prev].reduce((a,b)=>a+b,0)

if(total>50){

const prob=transitions[symbol][prev][i]/total

transitionScore=prob*100

}

}

let pressure=0

if(streak[symbol]>=4&&i===digit)pressure=60

const score=droughtScore+rarity+transitionScore+pressure

if(score>bestScore){

bestScore=score
bestDigit=i

}

}

const entry=(bestDigit+3)%10

let stage="SCANNING"

if(bestScore>60)stage="FORMING"
if(bestScore>90)stage="READY"
if(bestScore>120)stage="ENTER"

signals[symbol]={

match:bestDigit,
entry:entry,
strength:Math.min(99,Math.floor(bestScore)),
stage:stage,
expiry:Date.now()+SIGNAL_WINDOW

}

})

app.get("/signals",(req,res)=>{

const now=Date.now()

const markets=[]

Object.keys(lastPrice).forEach(symbol=>{

const s=signals[symbol]

const expires=s?Math.max(0,Math.floor((s.expiry-now)/1000)):0

markets.push({

symbol,
price:lastPrice[symbol],
digit:lastDigit[symbol],
match:s?s.match:"-",
entry:s?s.entry:"-",
strength:s?s.strength:0,
stage:s?s.stage:"SCANNING",
expires

})

})

let best=null

markets.forEach(m=>{
if(!best||m.strength>best.strength)best=m
})

res.json({markets,best:best?best.symbol:null})

})

app.get("/",(req,res)=>{

res.send(`

<html>

<head>

<title>Deriv AI Analyzer</title>

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
box-shadow:0 0 15px #000;

}

.best{

border:2px solid #22c55e;
box-shadow:0 0 25px #22c55e;

}

.price{

font-size:18px;

}

.market{

font-size:13px;
color:#94a3b8;
margin-bottom:10px;

}

.match{

font-size:40px;
font-weight:bold;

}

.entry{

color:#22c55e;
margin-top:5px;

}

.stage{

margin-top:10px;
font-size:12px;

}

.timer{

margin-top:5px;
color:#fbbf24;

}

</style>

</head>

<body>

<h1>DERIV AI DIGIT ANALYZER</h1>

<div class="grid" id="grid"></div>

<script>

async function load(){

const res=await fetch("/signals")
const data=await res.json()

const grid=document.getElementById("grid")

grid.innerHTML=""

data.markets.forEach(m=>{

const best=m.symbol===data.best?"card best":"card"

grid.innerHTML+=\`

<div class="\${best}">

<div class="price">\${m.price||"-"}</div>

<div class="market">\${m.symbol}</div>

<div class="match">\${m.match}</div>

<div class="entry">entry digit \${m.entry}</div>

<div class="stage">\${m.stage}</div>

<div class="timer">\${m.expires}s</div>

</div>

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

console.log("AI Analyzer running on",PORT)

})
