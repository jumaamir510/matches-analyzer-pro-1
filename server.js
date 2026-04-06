const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

console.log("Deriv Self Learning Analyzer starting...")

const HISTORY_LIMIT = 10000

let MIN_DROUGHT = 25
let MIN_STRENGTH = 60

const ENTRY_COOLDOWN = 5
const TRADE_WINDOW = 5

let stats = {
wins:0,
losses:0
}

let openTrades = []

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

 checkOpenTrades(symbol,digit)

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
  entry="ENTER"

  openTrades.push({
   symbol,
   digit:bestDigit,
   ticksLeft:TRADE_WINDOW
  })

 }

 signals[symbol]={
  symbol,
  digit:bestDigit,
  strength,
  drought:drought[symbol][bestDigit],
  freq:(frequency[symbol][bestDigit]/h.length).toFixed(3),
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

 const total = stats.wins + stats.losses

 if(total<20) return

 const winrate = stats.wins/total

 if(winrate<0.50){

  MIN_DROUGHT+=2

 }

 if(winrate>0.65){

  MIN_DROUGHT=Math.max(20,MIN_DROUGHT-1)

 }

}

app.get("/signals",(req,res)=>{

 res.json({
 signals,
 stats,
 settings:{
  MIN_DROUGHT,
  MIN_STRENGTH
 }
 })

})

app.get("/",(req,res)=>{

res.send("<h1>Deriv Self Learning Analyzer Running</h1>")

})

app.listen(PORT,()=>{

 console.log("Server running on port",PORT)

})
