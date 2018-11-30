const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const sqlite3 = require('sqlite3').verbose()
const svgCaptcha = require('svg-captcha');
const app = express()
const db = new sqlite3.Database('./humming.hum')

const port = 8001
let sessionIDPool = {} // 此处，验证码验证完成后，应在signin那里将key删除，否则会不断扩张

app.use(express.static('static'))
app.set('view engine', 'pug')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser('secure:)key'))

app.use(function(req, res, next) {
  if (!req.signedCookies.sessionID) {
    let sessionID = Math.random().toString().slice(2) + Date.now()    
    res.cookie(
      'sessionID', sessionID,
      {signed: true}
    )
  }
  next()
})

app.use(function(req, res, next) {
  let dbResult = new Promise(function(resolve, reject) {
    db.serialize(function () {
      let sql = 'select * from user where username=?'
      db.get(sql, req.signedCookies.user, function(err, row) {
        if (err) {
          reject(err)
        } else {
          resolve(row)
        }
      })
    })
  })
  dbResult.then(function(row) {
    if (row === undefined) {
      req.user = null
    } else {
      req.user = req.signedCookies.user
      req.userID = row.id
    }
    next()
  }, function (err) {
    console.log('can not set user status, error at:')
    console.log(err)
    req.user = null
    next()
  })
})

app.route('/captcha')
  .get(function (req, res) {
    var captcha = svgCaptcha.create({
      noise: 2,
      ignoreChars: '0o1i',
      size: 3,
      background: '#f1f1f1',
    })
    sessionIDPool[req.signedCookies.sessionID] = captcha.text.toLowerCase()    
    res.type('svg');
    res.status(200).send(captcha.data);
  });

app.route('/')
  .get(function (req, res) {
    let sql = 'select feed.*, user.username\
    from feed left join user on feed.authorid = user.id\
    order by id desc limit 20;'
    let dbResult = new Promise(function (resolve, reject) {
      db.serialize (function () {
        db.all(sql, function(err, rows) {
          if (err) {
            reject(err)
          } else {
            resolve(rows)
          }
        })
      })
    })
    dbResult.then(function (rows) {   
      // res.send(rows)   
      res.render('feed',{
        user: req.user,
        data: rows
      })
    }, function(err){
      console.log('can not query the latest feeds, error at:')
      console.log(err)
      res.render('feed',{
        user: req.user
      })
    })
  })
  .post(function (req, res) {
    res.send('null')
  })

app.route('/signup')
  .get(function (req, res) {
    res.render('signup')
  })
  .post(function (req, res) {
    let sql = 'insert into user (username, password, email) values(?, ? ,?)'
    let username = req.body.username
    let password = req.body.password
    let email = req.body.email
    let dbResult = new Promise(function (resolve, reject) {
      db.serialize (function () {
        db.run(sql, username, password, email, function (err) {
          if (err) {
            reject(err)
          } else {
            resolve(this.lastID)
          }
        })
      })
    })
    dbResult.then(function(lastID) {
      console.log(lastID)
      res.render('signin', {message: '注册成功'})
    }, function (err) {
      console.log('can not insert new user infomation into the DB:')
      console.log(err)
      res.status(500).send('500 服务器错误 Something broke!')
    })
  })

app.route('/signin')
  .get(function (req, res) {
    if (req.signedCookies.user) {
      res.redirect('/')
    } else {      
      res.render('signin')
    }
  })
  .post(function (req, res) {    
    if (sessionIDPool[req.signedCookies.sessionID] === req.body.captcha.toLowerCase()) {
      if (req.signedCookies.user) {
        res.redirect('/')
      }
      let sql = 'select * from user where username=?and password=?'
      let username = req.body.username
      let password = req.body.password
      let dbResult = new Promise(function (resolve, reject) {
        db.serialize(function () {
          db.get(sql, username, password, function(err, row) {
            if (err) {
              reject(err)
            } else {
              resolve(row)
            }
          })
        })
      })
      dbResult.then(function(row) {
        if (row === undefined) {
          res.render('signin', {
            message: '用户名或密码错误',
          })
        } else {
          res.cookie('user', username, {signed: true})
          res.redirect('/')
        }
      }, function (err) {
        console.log('promise rejected:')
        console.log(err)
        res.send(err)
      })
    } else {
      res.render('signin', {
        message: '验证码错误',
      })
    }    
  })

app.route('/signout')
  .get(function (req, res) {
    res.clearCookie('user', req.signedCookies.user)
    res.redirect('/')
  })

app.route('/account')
  .get(function(req, res) {
    if (!req.signedCookies.user) {
      res.redirect('/signin')
    }
    let sql = 'select user.username, user.email from user where id=?'
    let dbResult = new Promise(function(resolve, reject) {
      db.serialize(function () {
        db.get(sql, req.userID, function (err, row) {
          if (err) {
            reject(err)
          } else {
            resolve (row)
          }
        })
      })
    })
    dbResult.then(function(row) {
      // res.send(row)
      res.render('account',{
        user: req.user,
        data: row,
      })
    }, function(err) {
      console.log(err)
      res.send(err)
    })
  })

app.route('/help')
  .get(function (req, res) {
    res.render('base', {message: 'help page', user: req.user})
  })

app.route('/status/:id')
  .get(function(req, res) {
    let sql = 'select feed.*, user.id as authorid, user.username\
    from feed left join user on feed.authorid = user.id\
    where feed.id = ?;'
    let dbResult = new Promise(function(resolve, reject) {
      db.serialize(function () {
        db.get(sql, req.params.id, function (err, row) {
          if (err) {
            reject(err)
          } else {
            resolve(row)
          }
        })
      })
    })
    dbResult.then(function (row) {
      res.render('status', {
        user: req.user,
        data: row,
      })
    }, function(err) {
      res.send(err)
    })
  })

app.route('/user/:id')
  .get(function(req, res) {
    let sql = 'select username, feed.* from user\
    left join feed on user.id = feed.authorid\
    where user.id=? order by id desc'
    let dbResult = new Promise(function(resolve, reject) {
      db.serialize(function () {
        db.all(sql, req.params.id, function (err, rows) {
          if (err) {
            reject(err)
          } else {
            resolve(rows)
          }
        })
      })
    })
    dbResult.then(function(rows) {
      // res.send(rows)
      res.render('user', {
        user: req.user,
        rows: rows
      })
    }, function(err) {
      console.log('cannot query error at:')
      console.log(err)
      res.send(err)
    })
  })

app.route('/create')
  .get(function (req, res) {
    res.render('create',{
      user: req.signedCookies.user
    })
  })
  .post(function(req, res){
    if (!req.signedCookies.user) {
      res.render('signin', {
        message: '请登录，再创建新动态'
      })
    } else {
      let sql = 'insert into feed(content, timestamp, authorid) values(?, ?, ?)'
      let dbResult = new Promise(function (resolve, reject) {
        db.serialize(function() {
          db.run(sql, req.body.feed, Date.now(), req.userID, function (err) {
            if (err) {
              reject(err)
            } else {
              resolve(this.lastID, this.changes )
            }
          })
        })
      })
      dbResult.then(function(lastID, changes){
        // lastID 指向刚刚创建的动态ID 主键
        res.redirect('/status/' + lastID)
      },function(err){
        console.log(err)
        res.send('create new status failed')
      })
    }    
  })

app.use(function (req, res, next) {
  res.status(404).send("404 Sorry can't find that!")
})

app.use (function(err, req, res, next) {
  console.error(err.stack)
  res.status(500).send(`500 Internal Server Error
  通用错误消息，服务器遇到了一个未曾预料的状况，导致了它无法完成对请求的处理。`)
})

app.listen(port, () => {
  console.log('app is running on http://localhost:%s',port)
})
