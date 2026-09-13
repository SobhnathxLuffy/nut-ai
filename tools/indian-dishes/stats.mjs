#!/usr/bin/env node
import fs from "node:fs";const r=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const c=k=>r.reduce((m,x)=>(m[x[k]]=(m[x[k]]||0)+1,m),{});console.log(JSON.stringify({records:r.length,categories:c("category"),families:c("family"),priorityBatches:c("priorityBatch")},null,2));
