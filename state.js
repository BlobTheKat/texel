import { BufReader, BufWriter } from './nanobuf.min.js'
import { Chunk, Color, colorToCss } from "./chunk.js"

export const API_ENDPOINT = localStorage.api_endpoint = 'https://server.rplace.live:8443'

export const ifloat = x => {
	const f = Math.floor(x)
	return (x-f) + (f<<16>>16)
}
export const iint = x => Math.floor(x)<<16>>16

export const worldChanged = []
export const chunks = new Map()
let lkey = -1, lch = undefined
export const getChunk = (x, y) => { const key = x>>8&0xff|y&0xff00; if(key == lkey) return lch; return lch=chunks.get(lkey = key) }

const transactionCachedPrices = new Map()

const loop = (x0, x1, y0, y1, fn) => {
	for(let x = x0; x != x1; x=x+1&0xff) for(let y = y0; y != y1; y=y+1&0xff) fn(x, y)
}

function stashChunkTransactionPrice(ch, key, x, y){
	if(transaction.size && ((tx0+tbasex>>>8)-x&0xff) >= 0 && ((ty0+tbasey>>>8)-y&0xff) >= 0 && (x-(tx1+tbasex>>>8)&0xff) >= 0 && (y-(ty1+tbasey>>>8)&0xff) >= 0){
		let p = 0, c = 0
		for(const k of transaction.keys()){
			const xa = tbasex+(k&32767)&0xffff, ya = tbasey+(k>>>15)&0xffff
			if((xa>>>8)!=x||(ya>>>8)!=y) continue
			p -= ch.priceFor(xa&255, ya&255)
			c++
		}
		if(p) transactionCachedPrices.set(key, p)
	}
}

const loadBuf = new BufWriter(), unloadBuf = new BufWriter()
const send = buf => { wsOpen&&ws.send(buf.toUint8Array()); buf.clear() }
const loadChunk = (x, y) => {
	const key = x|y<<8, ch = lkey == key ? lch : (lch=chunks.get(lkey = key))
	if(ch) return ch.ref++, ch
	if(!loadBuf.written){
		loadBuf.v32(C_SUBSCRIBE_TO)
		Promise.resolve(loadBuf).then(send)
	}
	loadBuf.u8(x), loadBuf.u8(y)
	chunks.set(lkey = key, lch = new Chunk())
	worldChanged.fire()
	return lch
}, unloadChunk = (x, y) => {
	const key = x|y<<8, ch = lkey == key ? lch : (lch=chunks.get(lkey = key))
	if(ch && !--ch.ref){
		if(!unloadBuf.written){
			unloadBuf.v32(C_UNSUBSCRIBE_FROM)
			Promise.resolve(unloadBuf).then(send)
		}
		unloadBuf.u8(x), unloadBuf.u8(y)
		chunks.delete(key)
		if(key == lkey) lch = undefined
		worldChanged.fire()
		ch.free()
		stashChunkTransactionPrice(ch, key, x, y)
	}
	return ch
}

let cx0 = 0, cx1 = 0, cy0 = 0, cy1 = 0
export function setArea(x0, x1, y0, y1){
	const nx0 = Math.floor(x0/256)&0xff, nx1 = Math.ceil(x1/256)&0xff, ny0 = Math.floor(y0/256)&0xff, ny1 = Math.ceil(y1/256)&0xff
	if(((nx0-cx1<<24)&(cx0-nx1<<24)&(ny0-cy1<<24)&(cy0-ny1<<24))>=0){
		loop(cx0, cx1, cy0, cy1, unloadChunk)
		loop(nx0, nx1, ny0, ny1, loadChunk)
	}else{
		let l = nx0, r = nx1
		let diff = nx0-cx0<<24
		if(diff<0) loop(nx0, cx0, ny0, ny1, loadChunk), l = cx0
		else if(diff>0) loop(cx0, nx0, cy0, cy1, unloadChunk)
		diff = cx1-nx1<<24
		if(diff<0) loop(cx1, nx1, ny0, ny1, loadChunk), r = cx1
		else if(diff>0) loop(nx1, cx1, cy0, cy1, unloadChunk)
		diff = ny0-cy0<<24
		if(l != r){
			if(diff<0) loop(l, r, ny0, cy0, loadChunk)
			else if(diff>0) loop(l, r, cy0, ny0, unloadChunk)
			diff = cy1-ny1<<24
			if(diff<0) loop(l, r, cy1, ny1, loadChunk)
			else if(diff>0) loop(l, r, ny1, cy1, unloadChunk)
		}
	}
	cx0 = nx0; cx1 = nx1; cy0 = ny0; cy1 = ny1
}

export const MAX_ZOOM = 4096

const transaction = new Map(), cssColCache = new Map()
let tbasex = 0, tbasey = 0
let tx0 = 0, tx1 = 0, ty0 = 0, ty1 = 0

export const MAX_TRANSACTION_DIMENSIONS = 256
export const MAX_TRANSACTION_PIXELS = 4096

function _cleanupTransaction(){
	cssColCache.clear()
	transactionCachedPrices.clear()
	transactionPrice = 0
}

export function clearTransaction(feedback){
	if(!transaction.size) return 1
	if(!feedback){
		for(const k of transaction.keys())
			unloadChunk(tbasex+(k&32767)>>8&255, tbasey+(k>>15)>>8&255)
		transaction.clear(); cssColCache.clear()
		transactionCachedPrices.clear()
		transactionPriceChanged.fire(transactionPrice = 0)
		return 2
	}
	const old = []
	for(const {0:k,1:v} of transaction) old.push(k, v), unloadChunk(tbasex+(k&32767)>>8&255, tbasey+(k>>15)>>8&255)
	const bx = tbasex, by = tbasey, bx0 = tx0, bx1 = tx1, by0 = ty0, by1 = ty1
	transaction.clear(); cssColCache.clear()
	transactionCachedPrices.clear()
	transactionPriceChanged.fire(transactionPrice = 0)
	const undo = () => {
		tbasex = bx; tbasey = by; tx0 = bx0; tx1 = bx1; ty0 = by0; ty1 = by1
		for(const k of transaction.keys())
			unloadChunk(tbasex+(k&32767)>>8&255, tbasey+(k>>15)>>8&255)
		transaction.clear(); cssColCache.clear()
		transactionCachedPrices.clear()
		transactionPrice = 0
		for(let i = 0; i < old.length; i+=2){
			const k = old[i], col = old[i+1]
			transaction.set(k, col)
			if(!cssColCache.has(col)) cssColCache.set(col, colorToCss(col))
			const x = (k&32767)+bx&0xffff, y = (k>>>15)+by&0xffff
			loadChunk(x>>8&255, y>>8&255)
			transactionPrice += getChunk(x, y)?.priceFor(x&255, y&255)??0
		}
		transactionPriceChanged.fire(transactionPrice)
	}
	feedback?.(old.length>>>1, undo)
	return 2
}

export function addToTransaction(x, y, col){
	if(!transaction.size){
		if(col<0) return 1
		loadChunk(x>>8&255, y>>8&255)
		transaction.set(1<<14|1<<29, col&0xffff)
		transactionPrice += getChunk(x, y)?.priceFor(x&255, y&255)??0
		if(!cssColCache.has(col)) cssColCache.set(col, colorToCss(col))
		tbasex = x-16384&0xffff; tbasey = y-16384&0xffff
		tx0 = tx1 = ty0 = ty1 = 16384
		transactionPriceChanged.fire(transactionPrice)
		return 2
	}
	const nx = x-tbasex&0xffff, ny = y-tbasey&0xffff
	if(nx>>>15|ny>>>15) return +(col<0)
	if(col<0){
		a: if(transaction.delete(nx|ny<<15)){
			unloadChunk(x>>8&255, y>>8&255)
			if(!transaction.size){
				_cleanupTransaction()
				break a
			}
			transactionPrice -= getChunk(x, y)?.priceFor(x&255, y&255)??0
			if(nx==tx0) tx0 = 32768
			if(nx==tx1) tx1 = -1
			if(ny==ty0) ty0 = 32768
			if(ny==ty1) ty1 = -1
			for(const k of transaction.keys()){
				const x = k&32767, y = k>>>15
				if(x<tx0) tx0 = x; if(x>tx1) tx1 = x
				if(y<ty0) ty0 = y; if(y>ty1) ty1 = y
			}
		}else return 1
	}else{
		const oldCol = transaction.get(nx|ny<<15)
		if(oldCol === col) return 1
		if(oldCol === undefined){
			if(transaction.size >= MAX_TRANSACTION_PIXELS) return 0
			let ttx0 = nx<tx0?nx:tx0, ttx1 = nx>tx1?nx:tx1, tty0 = ny<ty0?ny:ty0, tty1 = ny>ty1?ny:ty1
			if(ttx1-ttx0>=MAX_TRANSACTION_DIMENSIONS||tty1-tty0>=MAX_TRANSACTION_DIMENSIONS) return 0
			tx0 = ttx0; ty0 = tty0; tx1 = ttx1; ty1 = tty1
			transactionPrice += getChunk(x, y)?.priceFor(x&255, y&255)??0
		}
		if(!cssColCache.has(col)) cssColCache.set(col, colorToCss(col))
		loadChunk(x>>8&255, y>>8&255)
		transaction.set(nx|ny<<15, col)
	}
	transactionPriceChanged.fire(transactionPrice)
	return 2
}
export function bucketFillTransaction(x, y, targetCol, feedback){
	if(!transaction.size) return targetCol<0 ? 1 : addToTransaction(x, y, targetCol)
	x = x-tbasex&0xffff; y = y-tbasey&0xffff
	if(x<tx0||x>tx1||y<ty0||y>ty1){
		if(targetCol<0||transaction.size>1) return 1
		let ttx0 = x<tx0?x:tx0, ttx1 = x>tx1?x:tx1, tty0 = y<ty0?y:ty0, tty1 = y>ty1?y:ty1
		if(ttx1-ttx0>=MAX_TRANSACTION_DIMENSIONS||tty1-tty0>=MAX_TRANSACTION_DIMENSIONS) return 0
		tx0 = ttx0; ty0 = tty0; tx1 = ttx1; ty1 = tty1
	}
	const col = transaction.get(x|y<<15)??-1
	if(targetCol === col) return 1
	let i = 0, last = x|y<<15
	const stack = [last]
	const priceDiff = targetCol<0||col<0
	const _set = (k=0,t=targetCol) => {
		t < 0 ? transaction.delete(k) : transaction.set(k, t)
		if(!priceDiff) return
		const x = (k&32767)+tbasex&0xffff, y = (k>>>15)+tbasey&0xffff
		const ch = t<0 ? unloadChunk(x>>8&255, y>>8&255) : loadChunk(x>>8&255, y>>8&255)
		const price = ch?.priceFor(x&255, y&255)??0
		transactionPrice += t<0?-price:price
	}
	_set(x|y<<15)
	while(i < stack.length){
		let k = stack[i], from = (k>>>30)-!i; k &= 1073741823; i++
		const x = k&32767, y = k>>>15
		if(from!=0 && x>tx0 && last!=k-1 && (transaction.get(k-1)??-1) === col) _set(k-1), stack.push(last = k-1|1073741824)
		if(from!=1 && x<tx1 && last!=k+1 && (transaction.get(k+1)??-1) === col) _set(k+1), stack.push(last = k+1|0)
		if(from!=2 && y>ty0 && last!=k-32768 && (transaction.get(k-32768)??-1) === col) _set(k-32768), stack.push(last = k-32768|-1073741824)
		if(from!=3 && y<ty1 && last!=k+32768 && (transaction.get(k+32768)??-1) === col) _set(k+32768), stack.push(last = k+32768|-2147483648)
	}
	const undo = () => {
		for(const k of stack) _set(k&1073741823, col)
		if(!cssColCache.has(col)) cssColCache.set(col, colorToCss(col))
		if(targetCol < 0 || col < 0){
			tx0 = 32768; tx1 = -1
			ty0 = 32768; ty1 = -1
			for(const k of transaction.keys()){
				const x = k&32767, y = k>>>15
				if(x<tx0) tx0 = x; if(x>tx1) tx1 = x
				if(y<ty0) ty0 = y; if(y>ty1) ty1 = y
			}
			if(!transaction.size) _cleanupTransaction()
		}
	}
	if(targetCol < 0){
		tx0 = 32768; tx1 = -1
		ty0 = 32768; ty1 = -1
		for(const k of transaction.keys()){
			const x = k&32767, y = k>>>15
			if(x<tx0) tx0 = x; if(x>tx1) tx1 = x
			if(y<ty0) ty0 = y; if(y>ty1) ty1 = y
		}
		if(!transaction.size) _cleanupTransaction()
	}else{
		if(col < 0 && transaction.size > MAX_TRANSACTION_PIXELS)
			return undo(), 0
		if(!cssColCache.has(targetCol)) cssColCache.set(targetCol, colorToCss(targetCol))
	}
	feedback?.(stack.length-1, undo)
	transactionPriceChanged.fire(transactionPrice)
	return 3
}

export function offsetTransaction(dx=0, dy=0){
	tbasex = tbasex+dx&0xffff; tbasey = tbasey+dy&0xffff
	checkPrice()
}


const checkPrice = globalThis.checkPrice = () => {
	transactionPrice = 0
	for(const k of transaction.keys()){
		const x = tbasex+(k&32767)&0xffff, y = tbasey+(k>>>15)&0xffff
		transactionPrice += getChunk(x, y)?.priceFor(x&255, y&255)??0
	}
	transactionPriceChanged.fire(transactionPrice)
	return transactionPrice/1e4
}

export function getTransactionPixels(cb){
	if(!transaction.size) return null
	if(cb) for(const {0:k,1:v} of transaction) cb((k&32767)+tbasex<<16>>16, (k>>>15)+tbasey<<16>>16, v, cssColCache.get(v))
	return {minX: tx0+tbasex<<16>>16, maxX: tx1+tbasex+1<<16>>16, minY: ty0+tbasey<<16>>16, maxY: ty1+tbasey+1<<16>>16, count: transaction.size, price: transactionPrice}
}

export const transactionSize = () => transaction.size
export let transactionPrice = 0

let transactionCb = null
export function commitTransaction(cb, max = -1){
	if(!transaction.size || balance < transactionPrice || !wsOpen || transactionCb) return void cb(0, 0)
	const buf = new BufWriter()
	buf.v32(C_PIXEL_TRANSACTION)
	buf.u16(tbasex+tx0); buf.u16(tbasey+ty0)
	buf.u64(max)
	let arr = []
	for(const {0:k,1:v} of transaction){
		const x = (k&32767)-tx0, y = (k>>>15)-ty0
		if((x|y)>>8) return void cb(0, 0)
		arr.push(x|y<<8|v<<16)
	}
	arr.sort((a,b) => (a&0xffff)-(b&0xffff))
	for(const v of arr) buf.u32(v)
	ws.send(buf.toUint8Array())
	transactionCb = cb
	balanceChanged.fire(balance -= transactionPrice, balanceIncrease, false)
}

export const transactionPriceChanged = []
export const balanceChanged = []
export let balance = 0, balanceIncrease = 0
export let token = localStorage.texel_token ?? ''
export const tokenChanged = []
export let ws = null
let tokenFromLS = true, wsOpen = false
export function clearToken(){
	delete localStorage.token
	tokenFromLS = true
	tokenChanged.fire(token = '', false)
	refreshConnection()
}
export function setTokenLocal(t = ''){
	tokenFromLS = false
	if(token != (token = t)) refreshConnection()
}

const S_META_PACKET = 1, S_CHUNK_DATA = 16, S_PIXEL_UPDATE = 24, S_PIXEL_UPDATE_OWNED = 25
const S_PIXEL_TRANSACTION_RESULT = 32
const C_SUBSCRIBE_TO = 8, C_UNSUBSCRIBE_FROM = 9, C_PIXEL_TRANSACTION = 10
const C_CLEAR_BALANCE_NOTIF = 15
const S_META_TAGS = { BALANCE: 1, BALANCE_NOTIF: 2 }
const packetHandlers = []

packetHandlers[S_META_PACKET] = buf => {
	const prevBalanceIncrease = balanceIncrease
	let tag = buf.v32()
	while(tag){ switch(tag){
		case S_META_TAGS.BALANCE:
			balance = buf.u64()
			break
		case S_META_TAGS.BALANCE_NOTIF:
			balanceIncrease = buf.u64()
			break
	} tag = buf.v32() }
	balanceChanged.fire(balance, balanceIncrease, balanceIncrease && !prevBalanceIncrease)
}

export const clearBalanceNotif = () => {
	if(!ws || !wsOpen) return false
	const buf = new BufWriter()
	buf.v32(C_CLEAR_BALANCE_NOTIF)
	buf.u64(balanceIncrease)
	ws.send(buf.toUint8Array())
	balanceChanged.fire(balance, balanceIncrease = 0, false)
	return true
}

packetHandlers[S_PIXEL_TRANSACTION_RESULT] = buf => {
	if(!buf.remaining)
		return void(transactionCb?.(0, 0), transactionCb = null)
	transactionCb?.(buf.v32(), buf.u64()), transactionCb = null
	clearTransaction()
}

packetHandlers[S_CHUNK_DATA] = buf => {
	const x = buf.u8(), y = buf.u8(), key = x|y<<8
	const ch = chunks.get(key)
	if(!ch) return
	if(ch.ready) stashChunkTransactionPrice(ch, key, x, y)
	ch.parse(buf)
	let p = transactionCachedPrices.get(key)??0
	if(p) transactionCachedPrices.delete(key)
	for(const k of transaction.keys()){
		const xa = tbasex+(k&32767)&0xffff, ya = tbasey+(k>>>15)&0xffff
		if(((xa>>8)|(ya&0xff00))!=key) continue
		p += ch.priceFor(xa&255, ya&255)
	}
	transactionPrice += p
}
const pixelUpdateHandler = owned => buf => {
	const key = buf.u8() | buf.u8()<<8
	let cx = key&0xff<<8, cy = key&0xff00
	const ch = chunks.get(key)
	if(!ch) return
	let tprice0 = 0
	while(buf.remaining){
		const n = buf.u32(), price = buf.u32()
		const xa = n&255, ya = n>>8&255
		if(transaction.size){
			const tx = cx+xa-tbasex&0xffff, ty = cy+ya-tbasey&0xffff
			if(!((tx|ty)>>15) && transaction.has(tx|ty<<15)){
				const a = ch.priceFor(xa, ya)
				ch.setPixel(xa, ya, n>>>16, price, owned)
				tprice0 += ch.priceFor(xa, ya)-a
				continue
			}
		}
		ch.setPixel(xa, ya, n>>>16, price, owned)
	}
	if(tprice0)
		transactionPriceChanged.fire(transactionPrice += tprice0)
	worldChanged.fire()
}
packetHandlers[S_PIXEL_UPDATE] = pixelUpdateHandler(0)
packetHandlers[S_PIXEL_UPDATE_OWNED] = pixelUpdateHandler(1)
const _onopen = e => {
	e.target.onopen = null
	if(e.target != ws) return
	wsOpen = true
	if(transactionCb) transactionCb(0, 0), transactionCb = null
	if(chunks.size){
		const buf = new BufWriter()
		buf.v32(C_SUBSCRIBE_TO)
		for(const k of chunks.keys())
			buf.u8(k&255), buf.u8(k>>8)
		ws.send(buf.toUint8Array())
	}
	connectionStateChanged.fire(CONNECTION.OPEN)
}

export const CONNECTION = {FAILED: 0, CONNECTING: 1, OPEN: 2}
export const connectionStateChanged = []
export function refreshConnection(){
	if(ws && ws.readyState != WebSocket.CLOSED) ws.close()
	connectionStateChanged.fire(CONNECTION.CONNECTING)
	const ws1 = ws = new WebSocket(API_ENDPOINT + '/' + token)
	balanceChanged.fire(balance = 0, balanceIncrease = 0, false)
	ws1.binaryType = 'arraybuffer'
	ws1.onmessage = ({data}) => {
		const buf = new BufReader(data), fn = packetHandlers[buf.v32()]
		fn ? fn(buf) : console.warn('Unhandled packet %o', buf)
	}
	ws1.onopen = _onopen
	ws1.onclose = e => {
		if(ws != ws1) return
		wsOpen = false
		console.warn('Socket closed code=%s reason=%s', e.code, e.reason)
		if(e.code == 3003){
			clearToken()
			return
		}
		if(e.code == 1006 || e.code == 1005) connectionStateChanged.fire(CONNECTION.FAILED)
		else refreshConnection()
	}
}

export const transactionOutOfScreen = () => {
	if(!transaction.size) return false
	const left = tbasex+tx0&0xff00, right = tbasex+tx1+63&0xff00
	const bottom = tbasey+ty0&0xff00, top = tbasey+ty1+63&0xff00
	for(let x = left; x != right; x = x+256&0xffff)
		for(let y = bottom; y != top; y = y+256&0xffff)
			if(getChunk(x, y)) return false
	return true
}

export const transactionPixelOwnershipSummary = () => {
	let owned = 0, prevOwned = 0, new_ = 0
	for(const k of transaction.keys()){
		const x = tbasex+(k&32767)&0xffff, y = tbasey+(k>>>15)&0xffff, ch = getChunk(x, y)
		if(!ch) return {owned: -1, prevOwned: -1, new: -1}
		const i = x&255|(y&255)<<8
		const own = ch.ownerData[i>>2]>>((i&3)<<1)&3
		if(own&1) owned++
		else if(own) prevOwned++
		else new_++
	}
	return {owned, prevOwned, new: new_}
}

export const MIN_DEPOSIT = 500, WITHDRAW_FEE = 5

let serverTest = null
const cbs = new Map()
window.addEventListener('storage', e => {
	if(e.key == 'paymentToken' && e.newValue){
		const {0:seq, 1:tok} = e.newValue.split('\n')
		cbs.get(seq)?.(tok)
		delete localStorage.paymentToken
	}else if(e.key == 'texel_token' && tokenFromLS){
		token = e.newValue ?? ''
		refreshConnection()
		tokenChanged.fire(token, true)
	}
})
delete localStorage.paymentToken
export function checkoutDeposit(amt, cb){
	
}
export function checkoutWithdraw(amt){
	
}

const CLIENT_ID = '533042686748-jsfaclp458gdl6gs51uoj6t3bik0fs7s.apps.googleusercontent.com'
export function requestAuth(){
	window.open('https://accounts.google.com/o/oauth2/v2/auth?client_id='+encodeURIComponent(CLIENT_ID)+'&redirect_uri='+encodeURIComponent(location.origin)+'/oauth2&response_type=code&scope=openid+email+profile&access_type=online', '', 'popup,width=500,height=600')
}