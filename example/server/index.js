const path = require("path");
const setupResolveTrace = require("../../");//require('resolve-browser-trace')
const express = require('express')
const bodyParser = require("body-parser");
const app = express()
const port = 3000
const pathToOutput = path.resolve(__dirname, "../output")
const sourceDecoder = setupResolveTrace(path.resolve(pathToOutput, "private"))

//Here we are configuring express to use body-parser as middle-ware.
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.sendFile(path.resolve(pathToOutput, "index.html"));
})

app.post('/api/error', (req, res) => {
  
  sourceDecoder("29a5d7571ba82f2e63c0",req.body.stack)
        .then(newStack => {
          
          console.log(" ==================== Min client stacktrace")
          console.log(req.body.stack)
          console.log(" ==================== Clean client stacktrace")
          console.log(newStack.join("\n"))
          console.log(" ==================== ")
          
        })
        
  res.end();
})

app.use('/public', express.static(path.resolve(pathToOutput, "public")))

app.listen(port, () => {
  console.log(`Resolve-Browser-Trace ~ Example listening on port:${port}`)
})