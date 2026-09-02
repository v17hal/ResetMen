#!/usr/bin/env bash
# The booking flow the client specified, happy path and negative, end to end.
#
#   login -> book -> no phone blocks -> phone -> booking pending, no QR
#   -> admin sees it unpaid with the number -> marks paid -> QR live -> check-in works
#   -> and the cancel branch, and every way it should refuse.

API=https://api.resetmen.in/api/v1
FBKEY=AIzaSyAtZ3_K6iOvW7I0vxiRRGrKRooT73sMjDA
SVC=e402f7f6-b1be-4bc1-858d-90e844dea894
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$D/flow.tsv}"
: > "$OUT"
PASS=0; FAIL=0

ex() { tr -d '\n' | sed -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)\"?.*/\1/"; }
code() { curl -s -o $D/f_body.json -w "%{http_code}" --max-time 25 "$@"; }
t() {
  local st
  if [ "$4" = "$5" ]; then st=PASS; PASS=$((PASS+1)); else st=FAIL; FAIL=$((FAIL+1)); fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$st" >> "$OUT"
  printf '  %-4s %-6s %-52s %s\n' "$st" "$1" "$3" "$5"
}

J="Content-Type: application/json"

# The first upcoming day that is actually open. A fixed offset lands on a Monday one week in
# five, the store is shut, and every booking assertion fails for want of a slot — which
# looks exactly like a regression and is not one.
TOM=""
for off in 1 2 3 4 5 6 7; do
  DAY=$(date -d "+$off days" +%Y-%m-%d)
  N=$(curl -s "$API/availability/slots?serviceId=$SVC&date=$DAY" --max-time 25 |
      grep -o '"startsAt"' | wc -l | tr -d ' ')
  if [ "$N" -gt 40 ]; then TOM="$DAY"; break; fi
done
[ -z "$TOM" ] && { echo "No open day with free slots in the next week — cannot run."; exit 1; }
echo "Using $TOM ($(date -d "$TOM" +%A))"

# Unique per run: User.phone is unique, and a fixed number collides with the last run.
PHONE="+919$(date +%s | tail -c 10)"

echo "── 1. Customer signs in ──"
EMAIL="flow-$(date +%s)@resetmen.in"
IDT=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$FBKEY" -H "$J" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"FlowTest-Pw-9\",\"returnSecureToken\":true}" --max-time 25 | ex idToken)
ACC=$(code -X POST "$API/auth/firebase" -H "$J" -d "{\"idToken\":\"$IDT\"}" >/dev/null; cat $D/f_body.json | ex accessToken)
A="Authorization: Bearer $ACC"
t F01 Login "Signs in and gets a session"                    yes "$([ ${#ACC} -gt 50 ] && echo yes || echo no)"
t F02 Login "Profile starts with no phone"                   null "$(curl -s "$API/auth/me" -H "$A" --max-time 20 | ex phone)"

echo ""
echo "── 2. Booking is blocked until a number is given ──"
SLOT=$(curl -s "$API/availability/slots?serviceId=$SVC&date=$TOM" --max-time 25 | sed -E 's/.*"slots":\[\{"startsAt":"([^"]*)".*/\1/')
BODY="{\"serviceId\":\"$SVC\",\"startsAt\":\"$SLOT\",\"addonIds\":[]}"
t F10 Phone "Booking refused without a number"               422 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "$BODY")"
t F11 Phone "Refusal names the phone field"                  phone "$(cat $D/f_body.json | ex field)"
t F12 Phone "Rubbish number refused"                         422 "$(code -X PATCH "$API/auth/me" -H "$A" -H "$J" -d '{"phone":"+911234567890123"}')"
t F13 Phone "Real number accepted"                           200 "$(code -X PATCH "$API/auth/me" -H "$A" -H "$J" -d "{\"phone\":\"$PHONE\",\"name\":\"Flow Test\"}")"

echo ""
echo "── 3. Booking is made, and is pending, not confirmed ──"
t F20 Book "Hold succeeds with a number"                     201 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "$BODY")"
BID=$(cat $D/f_body.json | ex bookingId); PUB=$(cat $D/f_body.json | ex publicId)
t F21 Book "No payment is demanded"                          false "$(cat $D/f_body.json | ex paymentRequired)"
t F22 Book "Booking reads back"                              200 "$(code "$API/bookings/$BID" -H "$A")"
t F23 Book "Reported as unpaid"                              false "$(cat $D/f_body.json | ex isPaid)"
t F24 Book "No entry code while unpaid"                      null "$(cat $D/f_body.json | ex checkinPayload)"
t F25 Book "Appears in the customer's list"                  1 "$(code "$API/bookings" -H "$A" >/dev/null; grep -c "$BID" $D/f_body.json)"

echo ""
echo "── 4. Negative: what must still be refused ──"
t F30 Neg "Same slot twice"                                  409 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "$BODY")"
t F31 Neg "A time in the past"                               409 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"2026-08-01T09:00:00+05:30\",\"addonIds\":[]}")"
t F32 Neg "A closed Monday"                                  409 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$(date -d 'next monday' +%Y-%m-%d)T10:00:00+05:30\",\"addonIds\":[]}")"
t F33 Neg "Outside opening hours"                            409 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"${TOM}T03:00:00+05:30\",\"addonIds\":[]}")"
t F34 Neg "Beyond the booking horizon"                       409 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$(date -d '+300 days' +%Y-%m-%d)T10:00:00+05:30\",\"addonIds\":[]}")"
t F35 Neg "An unknown service"                               404 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"7f97c88f-0000-0000-0000-000000000000\",\"startsAt\":\"$SLOT\",\"addonIds\":[]}")"
t F36 Neg "Someone else's booking"                           404 "$(code "$API/bookings/7f97c88f-0000-0000-0000-000000000000" -H "$A")"
t F37 Neg "A booking without signing in"                     401 "$(code -X POST "$API/bookings/hold" -H "$J" -d "$BODY")"

echo ""
echo "── 5. Admin sees it on the chase list ──"
ADM=$(code -X POST "$API/admin/auth/login" -H "$J" -d '{"email":"admin@resetmen.in","password":"Reset@123"}' >/dev/null; cat $D/f_body.json | ex accessToken)
AA="Authorization: Bearer $ADM"
code "$API/admin/bookings/timeline?date=$TOM" -H "$AA" >/dev/null
ROW=$(cd "$D" && python -c "
import json,io
d=json.load(io.open('f_body.json',encoding='utf-8'))
for s in d['stations']:
    for b in s['bookings']:
        if b['publicId']=='$PUB': print(json.dumps(b)); break
" 2>/dev/null)
t F40 Admin "Booking is on the timeline"                     yes "$([ -n "$ROW" ] && echo yes || echo no)"
t F41 Admin "Shown as unpaid"                                false "$(echo "$ROW" | ex isPaid)"
t F42 Admin "Customer's number is visible"                   "$PHONE" "$(echo "$ROW" | ex customerPhone)"

echo ""
CHECKIN="{\"publicId\":\"$PUB\"}"
echo "── 6. Unpaid cannot be checked in ──"
t F50 Checkin "Check-in by code refused while unpaid"        409 "$(code -X POST "$API/admin/checkins/manual" -H "$AA" -H "$J" -d "$CHECKIN")"
t F51 Checkin "Refusal says it is not paid"                  CHECKIN_INVALID "$(cat $D/f_body.json | ex code)"

echo ""
echo "── 7. Admin marks it paid ──"
t F60 Pay "Mark paid succeeds"                               201 "$(code -X POST "$API/admin/bookings/$BID/mark-paid" -H "$AA" -H "$J" -d '{"method":"CASH"}')"
t F61 Pay "Pressing twice does not double the takings"       true "$(code -X POST "$API/admin/bookings/$BID/mark-paid" -H "$AA" -H "$J" -d '{"method":"CASH"}' >/dev/null; cat $D/f_body.json | ex alreadyRecorded)"
code "$API/bookings/$BID" -H "$A" >/dev/null
t F62 Pay "Customer now sees it as paid"                     true "$(cat $D/f_body.json | ex isPaid)"
PAYLOAD=$(cat $D/f_body.json | ex checkinPayload)
t F63 Pay "Entry code is now issued"                         yes "$([ -n "$PAYLOAD" ] && [ "$PAYLOAD" != "null" ] && echo yes || echo no)"

echo ""
echo "── 8. Check-in works once paid ──"
t F70 Checkin "Check-in by code accepted"                    201 "$(code -X POST "$API/admin/checkins/manual" -H "$AA" -H "$J" -d "$CHECKIN")"
t F71 Checkin "Second check-in refused"                      409 "$(code -X POST "$API/admin/checkins/manual" -H "$AA" -H "$J" -d "$CHECKIN")"

echo ""
echo "── 9. The cancel branch ──"
curl -s "$API/availability/slots?serviceId=$SVC&date=$TOM" --max-time 25 -o "$D/slots2.json"
SLOT2=$(cd "$D" && python -c "import json,io; s=json.load(io.open('slots2.json',encoding='utf-8'))['slots']; print(s[min(20,len(s)-1)]['startsAt'])")
t F80 Cancel "A second booking can be made"                  201 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$SLOT2\",\"addonIds\":[]}")"
BID2=$(cat $D/f_body.json | ex bookingId)
t F81 Cancel "Admin can cancel an unpaid booking"            201 "$(code -X POST "$API/admin/bookings/$BID2/status" -H "$AA" -H "$J" -d '{"status":"CANCELLED","reason":"Payment not made"}')"
code "$API/bookings/$BID2" -H "$A" >/dev/null
t F82 Cancel "Customer sees it cancelled"                    CANCELLED "$(cat $D/f_body.json | ex status)"
t F83 Cancel "The slot is free again"                        201 "$(code -X POST "$API/bookings/hold" -H "$A" -H "$J" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$SLOT2\",\"addonIds\":[]}")"
BID3=$(cat $D/f_body.json | ex bookingId)

echo ""
echo "passed=$PASS failed=$FAIL total=$((PASS+FAIL))"
printf 'SUMMARY\t%s\t%s\t%s\n' "$PASS" "$FAIL" "$((PASS+FAIL))" >> "$OUT"
echo "$IDT" > $D/flow_idt
