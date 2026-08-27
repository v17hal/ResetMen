#!/usr/bin/env bash
# Full end-to-end regression against production.
#
# Creates a throwaway Firebase user and a booking, exercises the whole flow, then removes
# everything it made. Results are written as TSV so the report and the client sheet are
# generated from the run rather than transcribed from it.

API=https://api.resetmen.in/api/v1
FBKEY=AIzaSyAtZ3_K6iOvW7I0vxiRRGrKRooT73sMjDA
OUT="${1:-/tmp/e2e_results.tsv}"
SVC=e402f7f6-b1be-4bc1-858d-90e844dea894

: > "$OUT"
PASS=0; FAIL=0

ex() { tr -d '\n' | sed -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)\"?.*/\1/"; }
code() { curl -s -o /tmp/e2e_body.json -w "%{http_code}" --max-time 25 "$@"; }

# rec <id> <area> <case> <expected> <actual> [note]
rec() {
  local status
  if [ "$4" = "$5" ]; then status=PASS; PASS=$((PASS+1)); else status=FAIL; FAIL=$((FAIL+1)); fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$status" "${6:-}" >> "$OUT"
  printf '  %-4s %-7s %-46s %s\n' "$status" "$1" "$3" "$5"
}
# recin <id> <area> <case> <expected-set> <actual> [note]
recin() {
  local status
  case " $4 " in *" $5 "*) status=PASS; PASS=$((PASS+1));; *) status=FAIL; FAIL=$((FAIL+1));; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "one of: $4" "$5" "$status" "${6:-}" >> "$OUT"
  printf '  %-4s %-7s %-46s %s\n' "$status" "$1" "$3" "$5"
}

echo "== 1. Infrastructure =="
rec T001 Infra "API health endpoint responds"            200 "$(code "$API/health/ready")"
rec T002 Infra "API reports database connected"          ok  "$(cat /tmp/e2e_body.json | ex database)"
rec T003 Infra "Customer site serves over HTTPS"         200 "$(code https://resetmen.in)"
rec T004 Infra "Admin site serves over HTTPS"            200 "$(code https://admin.resetmen.in)"
rec T005 Infra "HTTP redirects to HTTPS"                 308 "$(code http://resetmen.in)"

echo "== 2. Public catalogue =="
rec T010 Catalog "Home catalogue loads"                  200 "$(code "$API/catalog/home")"
rec T011 Catalog "Store details load"                    200 "$(code "$API/catalog/store")"
rec T012 Catalog "Service by slug loads"                 200 "$(code "$API/catalog/services/head")"
rec T013 Catalog "Unknown service returns not-found"     404 "$(code "$API/catalog/services/no-such-service")"

echo "== 3. Availability =="
TOM=$(date -d '+1 day' +%Y-%m-%d)
rec T020 Avail "Slots load for tomorrow"                 200 "$(code "$API/availability/slots?serviceId=$SVC&date=$TOM")"
SLOTS=$(grep -o '"startsAt"' /tmp/e2e_body.json | wc -l | tr -d ' ')
recin T021 Avail "Tomorrow offers bookable slots"        "$(seq 1 400 | tr '\n' ' ')" "$SLOTS"
rec T022 Avail "Past date offers no slots"               0 "$(code "$API/availability/slots?serviceId=$SVC&date=$(date -d '-1 day' +%Y-%m-%d)" >/dev/null; grep -o '"startsAt"' /tmp/e2e_body.json | wc -l | tr -d ' ')"
rec T023 Avail "Day list loads"                          200 "$(code "$API/availability/days?serviceId=$SVC&from=$TOM&to=$(date -d '+7 days' +%Y-%m-%d)")"

echo "== 4. Authentication =="
rec T030 Auth "Bookings require a session"               401 "$(code "$API/bookings")"
rec T031 Auth "Profile requires a session"               401 "$(code "$API/auth/me")"
rec T032 Auth "Invalid token is rejected"                401 "$(code "$API/bookings" -H 'Authorization: Bearer not-a-token')"
rec T033 Auth "Invalid Firebase token is rejected"       422 "$(code -X POST "$API/auth/firebase" -H 'Content-Type: application/json' -d '{"idToken":"nonsense"}')"

EMAIL="qa-$(date +%s)@resetmen.in"; PASS_W="QaRun-Pw-2026"
IDT=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$FBKEY" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_W\",\"returnSecureToken\":true}" --max-time 25 | ex idToken)
rec T034 Auth "Firebase sign-up issues a token"          yes "$([ ${#IDT} -gt 100 ] && echo yes || echo no)"
ACC=$(code -X POST "$API/auth/firebase" -H 'Content-Type: application/json' -d "{\"idToken\":\"$IDT\"}" >/dev/null; cat /tmp/e2e_body.json | ex accessToken)
rec T035 Auth "Firebase token exchanges for a session"   yes "$([ ${#ACC} -gt 50 ] && echo yes || echo no)"
AUTH="Authorization: Bearer $ACC"
JSON="Content-Type: application/json"
rec T036 Auth "Profile readable with a session"          200 "$(code "$API/auth/me" -H "$AUTH")"

echo "== 5. Phone requirement =="
SLOT=$(curl -s "$API/availability/slots?serviceId=$SVC&date=$TOM" --max-time 25 | sed -E 's/.*"slots":\[\{"startsAt":"([^"]*)".*/\1/')
rec T040 Phone "Booking blocked without a phone number"  422 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$SLOT\",\"addonIds\":[]}")"
rec T041 Phone "Block names the phone field"             phone "$(cat /tmp/e2e_body.json | ex field)"
rec T042 Phone "Phone can be saved to the profile"       200 "$(code -X PATCH "$API/auth/me" -H "$AUTH" -H "$JSON" -d '{"phone":"+919800000001","name":"QA Run"}')"

echo "== 6. Booking =="
rec T050 Booking "Quote returns a price"                 201 "$(code -X POST "$API/bookings/quote" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$SLOT\",\"addonIds\":[]}")"
rec T051 Booking "Hold succeeds once phone is present"   201 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$SLOT\",\"addonIds\":[]}")"
BID=$(cat /tmp/e2e_body.json | ex bookingId); PUB=$(cat /tmp/e2e_body.json | ex publicId)
rec T052 Booking "Booking confirms immediately"          CONFIRMED "$(cat /tmp/e2e_body.json | ex status)"
rec T053 Booking "No payment demanded at booking"        false "$(cat /tmp/e2e_body.json | ex paymentRequired)"
rec T054 Booking "Booking appears in my bookings"        1 "$(code "$API/bookings" -H "$AUTH" >/dev/null; grep -c "$BID" /tmp/e2e_body.json)"
rec T055 Booking "Booking readable by id"                200 "$(code "$API/bookings/$BID" -H "$AUTH")"
rec T056 Booking "Confirm returns a check-in code"       201 "$(code -X POST "$API/bookings/$BID/confirm" -H "$AUTH" -H "$JSON" -d '{}')"

echo "== 7. Rejected bookings =="
rec T060 Reject "Past time refused"                      409 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"2026-08-01T09:00:00+05:30\",\"addonIds\":[]}")"
rec T061 Reject "Off-grid time refused"                  409 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"${TOM}T09:03:27+05:30\",\"addonIds\":[]}")"
rec T062 Reject "Beyond booking horizon refused"         409 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"$(date -d '+400 days' +%Y-%m-%d)T10:00:00+05:30\",\"addonIds\":[]}")"
rec T063 Reject "Closed day refused"                     409 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"2026-08-31T10:00:00+05:30\",\"addonIds\":[]}")"
rec T064 Reject "Outside opening hours refused"          409 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"$SVC\",\"startsAt\":\"${TOM}T03:00:00+05:30\",\"addonIds\":[]}")"
rec T065 Reject "Unknown service refused"                404 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d "{\"serviceId\":\"7f97c88f-0000-0000-0000-000000000000\",\"startsAt\":\"$SLOT\",\"addonIds\":[]}")"

echo "== 8. Input handling =="
rec T070 Input "Malformed id returns bad request"        400 "$(code "$API/bookings/not-a-uuid" -H "$AUTH")"
rec T071 Input "Malformed id on cancel"                  400 "$(code -X POST "$API/bookings/abc/cancel" -H "$AUTH" -H "$JSON" -d '{}')"
rec T072 Input "Malformed JSON rejected"                 400 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d '{oops')"
rec T073 Input "Missing field rejected"                  422 "$(code -X POST "$API/bookings/hold" -H "$AUTH" -H "$JSON" -d '{}')"
rec T074 Input "SQL injection in slug is harmless"       404 "$(code "$API/catalog/services/%27%20OR%201%3D1--")"
rec T075 Input "Unknown booking id returns not-found"    404 "$(code "$API/bookings/7f97c88f-0000-0000-0000-000000000000" -H "$AUTH")"

echo "== 9. Rewards and profile =="
rec T080 Rewards "Streak loads"                          200 "$(code "$API/rewards/streak" -H "$AUTH")"
rec T081 Rewards "Wallet loads"                          200 "$(code "$API/rewards/wallet" -H "$AUTH")"
rec T082 Rewards "Scratch cards load"                    200 "$(code "$API/rewards/scratch-cards" -H "$AUTH")"
rec T083 Profile "Profile update persists"               200 "$(code -X PATCH "$API/auth/me" -H "$AUTH" -H "$JSON" -d '{"name":"QA Updated"}')"
rec T084 Profile "Notifications list loads"              200 "$(code "$API/notifications" -H "$AUTH")"
rec T085 Catalog "Products list loads"                   200 "$(code "$API/products")"

echo "== 10. Admin =="
ADM=$(code -X POST "$API/admin/auth/login" -H "$JSON" -d '{"email":"admin@resetmen.in","password":"Reset@123"}' >/dev/null; cat /tmp/e2e_body.json | ex accessToken)
rec T090 Admin "Admin login succeeds"                    yes "$([ ${#ADM} -gt 50 ] && echo yes || echo no)"
AADM="Authorization: Bearer $ADM"
rec T091 Admin "Wrong admin password refused"            401 "$(code -X POST "$API/admin/auth/login" -H "$JSON" -d '{"email":"admin@resetmen.in","password":"NotTheRightPassword123"}')"
rec T092 Admin "Customer token cannot reach admin"       403 "$(code "$API/admin/products" -H "$AUTH")"
rec T093 Admin "Dashboard loads"                         200 "$(code "$API/admin/reports/dashboard" -H "$AADM")"
rec T094 Admin "Timeline loads"                          200 "$(code "$API/admin/bookings/timeline?date=$TOM" -H "$AADM")"
rec T095 Admin "Booking shows as unpaid"                 false "$(code "$API/admin/bookings/timeline?date=$TOM" -H "$AADM" >/dev/null; sed -E "s/.*\"publicId\":\"$PUB\"[^}]*\"isPaid\":([a-z]+).*/\1/" /tmp/e2e_body.json)"
rec T096 Admin "Customer phone visible to staff"         1 "$(grep -c '"customerPhone":"+919800000001"' /tmp/e2e_body.json)"
rec T097 Admin "Mark paid records the money"             201 "$(code -X POST "$API/admin/bookings/$BID/mark-paid" -H "$AADM" -H "$JSON" -d '{"method":"CASH","note":"QA run"}')"
rec T098 Admin "Mark paid is idempotent"                 true "$(code -X POST "$API/admin/bookings/$BID/mark-paid" -H "$AADM" -H "$JSON" -d '{"method":"CASH"}' >/dev/null; cat /tmp/e2e_body.json | ex alreadyRecorded)"
rec T099 Admin "Booking now shows as paid"               true "$(code "$API/admin/bookings/timeline?date=$TOM" -H "$AADM" >/dev/null; sed -E "s/.*\"publicId\":\"$PUB\"[^}]*\"isPaid\":([a-z]+).*/\1/" /tmp/e2e_body.json)"
rec T100 Admin "Staff list loads"                        200 "$(code "$API/admin/staff" -H "$AADM")"
rec T101 Admin "Catalog services load"                   200 "$(code "$API/admin/catalog/services" -H "$AADM")"
rec T102 Admin "Stations load"                           200 "$(code "$API/admin/stations" -H "$AADM")"
rec T103 Admin "Payments list loads"                     200 "$(code "$API/admin/payments" -H "$AADM")"
rec T104 Admin "Audit log loads"                         200 "$(code "$API/admin/audit" -H "$AADM")"
rec T105 Admin "Revenue report loads"                    200 "$(code "$API/admin/reports/revenue?from=$TOM&to=$TOM" -H "$AADM")"

echo "== 11. Cancellation =="
rec T110 Cancel "Customer can cancel own booking"        201 "$(code -X POST "$API/bookings/$BID/cancel" -H "$AUTH" -H "$JSON" -d '{"reason":"QA run"}')"
rec T111 Cancel "Cancelled booking reads as cancelled"   CANCELLED "$(code "$API/bookings/$BID" -H "$AUTH" >/dev/null; cat /tmp/e2e_body.json | ex status)"

echo
echo "passed=$PASS failed=$FAIL total=$((PASS+FAIL))"
printf 'SUMMARY\t%s\t%s\t%s\n' "$PASS" "$FAIL" "$((PASS+FAIL))" >> "$OUT"
echo "$EMAIL" > /tmp/e2e_qa_email
echo "$IDT" > /tmp/e2e_qa_idt
