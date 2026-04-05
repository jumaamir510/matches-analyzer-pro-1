
const WebSocket = require("ws")
const { Pool } = require("pg")

const app = express()
app.use(express.static("."))

const PORT = process.env.PORT || 3000

// Neon database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// signal engine
class Engine {

  constructor(){
    this.buffers={}
    this.maxTicks=10000
  }

  addTick(symbol,price){

    if(!this.buffers[symbol]){
      this.buffers[symbol]=[]
    }

    const buf=this.buffers[symbol]

    buf.push(price)

    if(buf.length>this.maxTicks){
      buf.shift()
    }

  }

  getDigits(buf){
    return buf.map(p=>Math.floor(p*1000)%10)
  }

  analyze(symbol){

    const buf=this.buffers[symbol]

    if(!buf || buf.length<500) return null

    const digits=this.getDigits(buf)

    const counts=Array(10).fill(0)

    digits.forEach(d=>counts[d]++)

    const expected=digits.length/10

    let bestDigit=0
    let bestScore=0

    counts.forEach((c,i)=>{

      const diff=(c-expected)/expected

      if(diff>bestScore){
        bestScore=diff
        bestDigit=i
      }

    })

    const strength=Math.min(Math.round(bestScore*100),100)

    if(strength<20) return null

    return {
      digit:bestDigit,
      strength
    }

  }

}

const engine=new Engine()

const symbols=[
"R_10",
"R_25",
"R_50",
"R_75",
"R_100"
]

const signals={}

// deriv websocket
const ws=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open",()=>{

  symbols.forEach(sym=>{

    ws.send(JSON.stringify({
      ticks:sym,
      subscribe:1
    }))

  })

})

ws.on("message",async data=>{

  const msg=JSON.parse(data)

  if(!msg.tick) return

  const symbol=msg.tick.symbol
  const price=msg.tick.quote

  engine.addTick(symbol,price)

  const signal=engine.analyze(symbol)

  if(signal){

    signals[symbol]=signal

    try{

      await pool.query(
        "INSERT INTO signals(symbol,digit,strength,time) VALUES($1,$2,$3,NOW())",
        [symbol,signal.digit,signal.strength]
      )

    }catch(err){
      console.log("DB error")
    }

  }

})

// api routes
app.get("/",(req,res)=>{
  res.send("Matches Analyzer Engine Running")
})

app.get("/api/signals",(req,res)=>{
  res.json(signals)
})

app.get("/api/history",async(req,res)=>{

  const result=await pool.query(
    "SELECT * FROM signals ORDER BY time DESC LIMIT 50"
  )

  res.json(result.rows)

})

app.listen(PORT,()=>{
  console.log("Server running on",PORT)
})
