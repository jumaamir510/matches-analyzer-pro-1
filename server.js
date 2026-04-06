const express = require("express")
const WebSocket = require("ws")

const app = express()
const PORT = process.env.PORT || 10000

let signals = {}

const symbols = [
 "R_10",
 "R_25",
 "R_50",
 "R_75",
 "R_100",
 "1HZ10V",
 "1HZ25V",
 "1HZ50V",
 "1HZ75V",
 "1HZ100V"
]

const tickHistory = {}

symbols.forEach(s => tickHistory[s] = [])

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")

ws.on("open", () => {
 console.log("Connected to Deriv")

 symbols.forEach(symbol => {
  ws.send(JSON.stringify({
   ticks: symbol,
   subscribe: 1
  }))
 })
})

ws.on("message", msg => {
 const data = JSON.parse(msg)

 if (data.tick) {

  const symbol = data.tick.symbol
  const price = data.tick.quote
  const digit = parseInt(price.toString().slice(-1))

  const history = tickHistory[symbol]

  history.push(digit)

  if (history.length > 300) history.shift()

  const counts = Array(10).fill(0)

  history.forEach(d => counts[d]++)

  let minDigit = 0
  let minCount = counts[0]

  for (let i = 1; i < 10; i++) {
   if (counts[i] < minCount) {
    minCount = counts[i]
    minDigit = i
   }
  }

  const strength = Math.floor((1 - minCount / history.length) * 100)

  signals[symbol] = {
   symbol,
   match_digit: minDigit,
   strength,
   timestamp: Date.now()
  }
 }
})

app.get("/signals", (req,res)=>{
 res.json(signals)
})

app.get("/", (req,res)=>{

res.send(`
<html>

<head>
<title>Deriv Matches Analyzer</title>

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
width:80%;
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

</style>

</head>

<body>

<h1>DERIV MATCHES ANALYZER</h1>

<table id="table">

<tr>
<th>Market</th>
<th>Digit</th>
<th>Strength</th>
<th>Status</th>
</tr>

</table>

<script>

async function load(){

 const res = await fetch("/signals")
 const data = await res.json()

 const table = document.getElementById("table")

 table.innerHTML = \`
<tr>
<th>Market</th>
<th>Digit</th>
<th>Strength</th>
<th>Status</th>
</tr>\`

 Object.values(data).forEach(s=>{

  let status="WEAK"
  let cls="weak"

  if(s.strength>70){status="STRONG";cls="good"}
  else if(s.strength>50){status="GOOD";cls="medium"}

  table.innerHTML+=\`
  <tr>
  <td>\${s.symbol}</td>
  <td>\${s.match_digit}</td>
  <td>\${s.strength}%</td>
  <td class="\${cls}">\${status}</td>
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

app.listen(PORT, ()=>{
 console.log("Deriv Matches Analyzer running...")
})
